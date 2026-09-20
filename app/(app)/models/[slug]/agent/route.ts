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
 * **Many chats now, not one.** The client sends `{ id, message }` — only the last message,
 * per the AI SDK's "sending only the last message" pattern — rather than the whole array,
 * because the whole array already lives here: `id` names an `AgentChat` row this handler
 * loads, appends to, and writes back. The client mints `id` itself (a fresh uuid for a chat
 * that does not exist yet), so the first turn of a brand-new conversation and the second
 * turn of an old one are the same code path — this either creates the row or updates it.
 *
 * **Ownership is checked before anything is read.** A chat id is only ever trusted if it is
 * either absent from the table (a new chat about to be created) or already scoped to this
 * exact `(modelId, actorId)` — never someone else's history, and never another model's.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const modelRow = await db.model.findUnique({ where: { slug }, select: { id: true } });
  if (!modelRow) return new Response("Not found", { status: 404 });

  const model = await readModel(db, slug);
  if (!model) return new Response("Not found", { status: 404 });

  const body = (await request.json()) as { id?: string; message?: UIMessage };
  const chatId = typeof body.id === "string" ? body.id : null;
  const incoming = body.message;
  if (!chatId || !incoming) return new Response("Bad request", { status: 400 });

  const actor = { id: session.user.id, name: session.user.name || session.user.email };

  const existing = await db.agentChat.findUnique({
    where: { id: chatId },
    select: { modelId: true, actorId: true, messages: true },
  });
  // Refuse silently-wrong ownership rather than quietly starting a fresh thread under
  // someone else's id — a 403 is the honest answer, not a conversation that looks continued
  // but is not.
  if (existing && (existing.modelId !== modelRow.id || existing.actorId !== actor.id)) {
    return new Response("Forbidden", { status: 403 });
  }

  const previousMessages = (existing?.messages as UIMessage[] | undefined) ?? [];
  const messages = [...previousMessages, incoming];

  const result = streamText({
    model: agentModel(),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildAgentTools({ model, modelId: modelRow.id, actor }),
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
        const payload = finalMessages as unknown as Prisma.InputJsonValue;
        if (existing) {
          await db.agentChat.update({ where: { id: chatId }, data: { messages: payload } });
        } else {
          await db.agentChat.create({
            data: {
              id: chatId,
              modelId: modelRow.id,
              actorId: actor.id,
              title: titleFrom(incoming),
              messages: payload,
            },
          });
        }
      },
    }),
  });
}

/** The opening question, trimmed to a sidebar-sized label — set once, at creation. */
export function titleFrom(message: UIMessage): string {
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
  if (!text) return "New chat";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}
