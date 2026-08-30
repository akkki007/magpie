import type { Topic } from "../types";
import serverComponents from "./01-server-components";
import hydration from "./02-hydration";
import staticRendering from "./03-static-rendering";

const topic: Topic = {
  slug: "nextjs-app-router",
  title: "Next.js 16 App Router",
  summary:
    "How the landing page in this repo actually renders: the server/client boundary, the hydration bug we hit, and what the build output tells you.",
  phase: "F",
  lessons: [serverComponents, hydration, staticRendering],
};

export default topic;
