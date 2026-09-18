import type { RunAgentInput } from "@ag-ui/core";

import { streamRunAsAGUI } from "@/lib/agents/agui-stream";

/**
 * The direct, per-run AG-UI endpoint — one run, named in the URL. See `lib/agents/
 * agui-stream.ts` for what this actually streams and why. `app/api/copilotkit/agent/
 * route.ts` is the other way to reach the same thing: CopilotKit's `useAgent` resolves a
 * *dynamically*-named agent (a run id nobody registered in advance) by dispatching to one
 * static runtime agent and carrying the run id as `threadId` in the request body instead of
 * the URL — this route exists for callers that already know the run id up front and would
 * rather put it in the path.
 */
export async function POST(request: Request, { params }: RouteContext<"/agents/[id]/agui">) {
  const { id } = await params;

  let input: Partial<RunAgentInput> = {};
  try {
    input = (await request.json()) as Partial<RunAgentInput>;
  } catch {
    // A malformed or empty body isn't fatal — the run named by the URL is authoritative.
  }

  return streamRunAsAGUI(id, request, input);
}
