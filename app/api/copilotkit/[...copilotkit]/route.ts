import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

/**
 * The CopilotKit Runtime backend — open-source, no `selfManagedAgents` (that tier needs a
 * paid `publicLicenseKey`; this route is the alternative that doesn't).
 *
 * **This still isn't a second brain.** The runtime holds no LLM adapter and does none of the
 * agent's reasoning — the one static agent it knows, `"financeOps"`, is an `HttpAgent` that
 * only forwards to `app/api/copilotkit-agent/route.ts`, which is where `OPENAI_API_KEY`
 * actually gets used (by way of `lib/agents/agui-stream.ts`, which is the one place both that
 * route and `app/(app)/agents/[id]/agui/route.ts` read from).
 *
 * **One static agent, not one per run.** `useAgent` in `components/agents/copilot-canvas.tsx`
 * only ever resolves an id that is already in this runtime's `/info` roster — it does not
 * look a fresh id up per call — and a run's id does not exist until someone spawns it, so it
 * can never be in that roster ahead of time. `"financeOps"` is the one name this runtime
 * declares; which *run* a request is actually about travels as `threadId` in the request
 * body instead, which is what CopilotKit's "thread-scoped" `useAgent` shape is for. See
 * `copilotkit-agent/route.ts` for the other half of this.
 */
const runtime = new CopilotRuntime({
  // A factory only so the agent's URL can be built from the request's own origin — every
  // call returns the same one static agent, never a different roster per request.
  agents: ({ request }) => ({
    financeOps: new HttpAgent({ url: new URL("/api/copilotkit-agent", request.url).toString() }),
  }),
  // The runtime's default forwarding policy only carries `authorization` and `x-*` headers
  // onto the outgoing agent call — confirmed live, `copilotkit-agent/route.ts` 401'd on every
  // call until this was added, because Better Auth's session lives in a plain `Cookie`
  // header and nothing was forwarding it. Allowlist mode, and only this one header: no reason
  // for anything else inbound to reach the agent call.
  forwardHeaders: { allow: ["cookie"] },
});

const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });

export { handler as GET, handler as POST };
