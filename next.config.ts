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
};

export default nextConfig;
