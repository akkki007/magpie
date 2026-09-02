import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";

import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { agentModel, buildAgentTools, SYSTEM_PROMPT } from "@/lib/model/openai-agent";
import { readModel } from "@/lib/model/persist";
import { getSession } from "@/lib/session";

/**
 * The agent's chat endpoint (`docs/modelling-plan.md` §5, M5.2), on `useChat`.
 *
 * A route handler, not a server action: `useChat`'s transport is a plain `fetch` that wants
 * a streaming HTTP response, and a server action's return value is a single RPC result —
 * exactly the shape the old hand-rolled loop returned, and exactly what "make the UI more
 * robust" asks to move past. `toUIMessageStreamResponse` is what lets token-by-token text
 * and tool-call state reach the client as they happen rather than all at once at the end.
 *
 * Auth is checked here, independently of the page — this endpoint is reachable by anyone who
 * can send it a POST, the same reasoning `models/actions.ts` gives for not trusting a page's
 * upstream check.
 *
 * One chat per model (`AgentChat`, keyed by `modelId`): the whole message history — text,
 * every tool call and its result, any pending approval — is overwritten on every turn's
 * `onFinish`. That is the durability M5.4 asked `AgentRun` for, now carried by the
 * richer, standard shape `useChat` already needs to rehydrate the panel after a refresh.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const modelRow = await db.model.findUnique({ where: { slug }, select: { id: true } });
  if (!modelRow) return new Response("Not found", { status: 404 });

  const model = await readModel(db, slug);
  if (!model) return new Response("Not found", { status: 404 });

  const { messages }: { messages: UIMessage[] } = await request.json();

  const result = streamText({
    model: agentModel(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildAgentTools({
      model,
      modelId: modelRow.id,
      actor: { id: session.user.id, name: session.user.name || session.user.email },
    }),
    // Read, read again, propose: a real turn is several tool calls deep.
    stopWhen: stepCountIs(12),
  });

  // Consumed even if the client disconnects, so a closed tab does not also lose the turn
  // that was already in flight — the same reasoning recon's batched calls give for paying
  // for work once it has started rather than discarding it.
  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: result.toUIMessageStream({
      originalMessages: messages,
      onFinish: async ({ messages: finalMessages }) => {
        await db.agentChat.upsert({
          where: { modelId: modelRow.id },
          create: { modelId: modelRow.id, messages: finalMessages as unknown as Prisma.InputJsonValue },
          update: { messages: finalMessages as unknown as Prisma.InputJsonValue },
        });
      },
    }),
  });
}
