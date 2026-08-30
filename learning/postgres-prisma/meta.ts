import type { Topic } from "../types";
import thePipelineBeforeTheQuery from "./01-the-pipeline-before-the-query";

const topic: Topic = {
  slug: "postgres-prisma",
  title: "Postgres and Prisma",
  summary:
    "Giving Magpie a database: what the migration pipeline actually produces, why the client has to be one object, and how to seed data you can trust.",
  phase: "A",
  lessons: [thePipelineBeforeTheQuery],
};

export default topic;
