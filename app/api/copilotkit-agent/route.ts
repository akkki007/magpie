import type { RunAgentInput } from "@ag-ui/core";

import { streamRunAsAGUI } from "@/lib/agents/agui-stream";

/**
 * What the static `"financeOps"` runtime agent (`app/api/copilotkit/[...copilotkit]/
 * route.ts`) actually forwards to.
 *
 * CopilotKit's `useAgent` only resolves an agent id that was already in the runtime's
 * `/info` roster — it does not look one up fresh per call. A run's id is minted the moment
 * someone spawns it, so it can never be in that roster ahead of time. The fix is CopilotKit's
 * own "thread-scoped" `useAgent` shape: `components/agents/copilot-canvas.tsx` registers
 * each run under its own id *client-side* (`agentId`), but has it dispatch through one
 * pre-registered `runtimeAgentId` ("financeOps") and carries the actual run as `threadId` —
 * which lands in this route's request body, not its URL. Same run, same stream
 * (`lib/agents/agui-stream.ts`) as `[id]/agui` — just addressed differently.
 */
export async function POST(request: Request) {
  let input: Partial<RunAgentInput> = {};
  try {
    input = (await request.json()) as Partial<RunAgentInput>;
  } catch {
    // Handled below — no threadId means no run to attach to.
  }

  const runId = input.threadId;
  if (!runId) return new Response("Bad request: no threadId", { status: 400 });

  return streamRunAsAGUI(runId, request, input);
}
