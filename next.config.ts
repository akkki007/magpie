import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Server-only packages Next must `require` rather than bundle.
   *
   * **`langsmith` is here because the deploy build failed and the local one did not.**
   * LangChain's tracing client ships `dist/sandbox/ws_execute.js`, which does an optional
   * `import("ws")` and falls back to HTTP when the package is absent — its own comment says
   * so: *"Resolves to the WebSocket constructor, or null if 'ws' isn't installed."* Nothing
   * in this repo uses websockets, and nothing calls that sandbox.
   *
   * But `ws` is only an **optional peer** of `langsmith`, so it is never installed on its
   * account. It was present locally because a *dev* dependency drags it in, and absent on the
   * deploy, which installs none — so Turbopack could resolve the import here and not there:
   *
   *     ./node_modules/langsmith/dist/sandbox/ws_execute.js:52:28
   *     Error: Module not found: Can't resolve 'ws'
   *
   * A build that passes only because of a dev dependency is a build that passes by accident.
   * Marking the package external is the fix rather than adding `ws` to the dependencies: the
   * import is *designed* to fail and be caught, so satisfying it would ship a websocket
   * library to production to keep a code path we never take from being statically analysed.
   * `langsmith` is server-only anyway — it has no business in a client bundle.
   *
   * Reproduced before and after by hiding `node_modules/ws`, which is the deploy's condition.
   */
  serverExternalPackages: ["langsmith"],

  /**
   * `data/recon/eval-report.json`, kept in the `/recon` function on purpose.
   *
   * `lib/recon/report.ts` reads that file with `readFileSync`, and the bundler traces
   * `import`/`require` — not file reads. It happens to find this one anyway: the path is
   * `join(dir, "eval-report.json")` with `dir` defaulting to a literal, and the tracer
   * constant-folds far enough to see it. Verified by building without this entry, where the
   * file still lands in `page.js.nft.json`.
   *
   * So this is insurance, not the fix. The inference holds only while the path stays
   * statically knowable — the day anyone calls `readRunReport(someComputedDir)` it stops,
   * silently, and the symptom is a production queue that is permanently empty while dev looks
   * perfect. Naming the file costs two lines and does not depend on how clever the tracer is.
   *
   * The actual bug this was found through was simpler: `/data` was gitignored, so the file
   * never reached the deployment at all and there was nothing to trace.
   */
  outputFileTracingIncludes: {
    "/recon": ["./data/recon/eval-report.json"],
  },
};

export default nextConfig;
