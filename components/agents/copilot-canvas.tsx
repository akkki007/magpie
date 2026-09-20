"use client";

import { Component, useEffect, type ReactNode } from "react";
import { CopilotKit, useAgent } from "@copilotkit/react-core/v2";

import { Canvas } from "@/components/agents/canvas";
import type { Artifact } from "@/lib/agents/artifacts";

/**
 * The canvas, fed by CopilotKit instead of the run's own `EventSource` — the generative-UI
 * layer from the approved plan's Workstream 2.
 *
 * **Through the open-source Runtime, not `selfManagedAgents`.** That option is CopilotKit's
 * paid Enterprise Intelligence tier — confirmed live, it logs "part of CopilotKit's Enterprise
 * Intelligence tier" without a `publicLicenseKey`. `app/api/copilotkit/[...copilotkit]/
 * route.ts` is the alternative: an open-source `CopilotRuntime` holding no LLM adapter of its
 * own and doing none of the agent's reasoning.
 *
 * **Thread-scoped, not one agent per run.** `useAgent` only resolves an id already in the
 * runtime's `/info` roster, and a run's id is minted the moment it's spawned — it can never
 * be in that roster ahead of time (confirmed live: naming the agent `runId` directly threw
 * "not found after runtime sync" every time). So each run registers under its own id
 * *client-side* but dispatches through the one static `runtimeAgentId` the runtime does
 * know — `"financeOps"` — carrying the real run as `threadId`, which is what
 * `app/api/copilotkit-agent/route.ts` reads to know which run to stream. `agent.state` is the
 * same `plan`/`steps`/`artifacts`/`activity` shape `[id]/stream` already sends; this
 * component only changes *how it arrives*.
 *
 * **Falls back to the caller's own snapshot**, not an empty canvas. `agent.state` starts
 * empty until the first `STATE_SNAPSHOT` round-trips, and a run that already finished before
 * this mounts still deserves a canvas immediately — so `run-view.tsx`'s own `run.artifacts`
 * (already current, from `[id]/stream`) is what shows until CopilotKit's state catches up or
 * overtakes it. Once populated, the two agree: the server sent both from the same bus event.
 */

type StreamedState = {
  activity?: string | null;
  artifacts?: Artifact[];
};

function StreamedCanvas({
  runId,
  live,
  fallback,
}: {
  runId: string;
  live: boolean;
  fallback: { artifacts: Artifact[]; files: [string, string][]; activity: string | null };
}) {
  // Thread-scoped: this run's id is the client-side registration name, but the runtime only
  // knows the static `runtimeAgentId` — the run itself travels as `threadId` in the request
  // body instead. See this file's top comment.
  const { agent, isReady } = useAgent({ agentId: runId, runtimeAgentId: "financeOps", threadId: runId });

  useEffect(() => {
    if (!live || !isReady) return;
    let cancelled = false;
    agent.runAgent().catch((error: unknown) => {
      if (!cancelled) console.error("CopilotKit agent stream failed:", error);
    });
    return () => {
      cancelled = true;
    };
  }, [agent, isReady, live]);

  const state = (agent.state ?? {}) as StreamedState;
  const artifacts = Array.isArray(state.artifacts) && state.artifacts.length > 0 ? state.artifacts : fallback.artifacts;
  const activity = state.activity !== undefined ? state.activity : fallback.activity;

  return <Canvas artifacts={artifacts} files={fallback.files} activity={activity} />;
}

/**
 * Nothing here should ever take the page down. CopilotKit's own client can throw
 * synchronously during render (a bad runtime sync, a protocol mismatch) — a class boundary is
 * the only mechanism React has for catching that, and the fallback is the plain, already-
 * working `Canvas`: a generative-UI layer failing closed to the view that does not need it is
 * the right shape of failure for a live financial workspace.
 */
class CopilotBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("CopilotKit canvas failed, falling back to the plain canvas:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function CopilotCanvas({
  runId,
  live,
  artifacts,
  files,
  activity,
}: {
  runId: string;
  live: boolean;
  artifacts: Artifact[];
  files: [string, string][];
  activity: string | null;
}) {
  return (
    <CopilotBoundary fallback={<Canvas artifacts={artifacts} files={files} activity={activity} />}>
      {/* `useSingleEndpoint={false}`: the runtime (`app/api/copilotkit/route.ts`) is mounted
          in multi-route mode — its agent factory reads the run id straight out of the
          `/agent/:agentId/run` path — and the provider's default negotiation sent a
          single-route envelope instead, which 404'd against it. Pin the transport so the two
          agree.

          No `agentId` prop on `<CopilotKit>`: that prop is only for `<CopilotChat>` — unused
          in this tree. `StreamedCanvas` asks `useAgent` for this run's id directly. */}
      <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false} enableInspector={false}>
        <StreamedCanvas runId={runId} live={live} fallback={{ artifacts, files, activity }} />
      </CopilotKit>
    </CopilotBoundary>
  );
}
