import type { PendingAction, Step } from "./run";

/**
 * What a run has produced, for the canvas (`docs/agents-plan.md` A5).
 *
 * The left pane shows *the work*, not a description of it: the table being designed, with
 * its real columns, while the run is still deciding whether to ask for it. That is the
 * difference between an approval screen and a diff — you are looking at the thing, and the
 * chat beside it is the conversation about the thing.
 *
 * Derived from the run's own steps and pending action rather than stored separately. A
 * second store would be a second thing that can disagree with what the agent actually did.
 */

export type TableDraft = {
  kind: "table";
  status: "proposed" | "created" | "declined";
  name: string;
  description?: string;
  fields: { name: string; type: string; options?: string[] }[];
};

export type ProposalDraft = {
  kind: "proposal";
  status: "proposed" | "created" | "declined";
  label: string;
  commands: unknown[];
};

export type TileDraft = {
  kind: "tile";
  status: "proposed" | "created" | "declined";
  boardSlug: string;
  spec: unknown;
};

export type Artifact = TableDraft | ProposalDraft | TileDraft;

type Args = Record<string, unknown>;

/**
 * A pending action becomes an artifact card. `status` comes from the *step* that carries the
 * same tool name, so a declined table stays on the canvas marked declined rather than
 * vanishing — a run you come back to has to show what was refused, not just what landed.
 */
export function artifactsOf(pending: PendingAction[], steps: Step[]): Artifact[] {
  const statusOf = (name: string): Artifact["status"] => {
    const step = [...steps].reverse().find((s) => s.name === name);
    if (step?.detail === "declined") return "declined";
    if (step?.detail === "waiting for approval") return "proposed";
    return "created";
  };

  const out: Artifact[] = [];

  for (const action of pending) {
    const artifact = fromArgs(action.name, action.args as Args, statusOf(action.name));
    if (artifact) out.push(artifact);
  }

  return out;
}

function fromArgs(name: string, args: Args, status: Artifact["status"]): Artifact | null {
  if (name === "createTable") {
    const fields = Array.isArray(args.fields) ? (args.fields as Args[]) : [];
    return {
      kind: "table",
      status,
      name: String(args.name ?? "Untitled table"),
      description: typeof args.description === "string" ? args.description : undefined,
      fields: fields.map((field) => ({
        name: String(field.name ?? ""),
        type: String(field.type ?? "TEXT"),
        options: Array.isArray(field.options) ? (field.options as string[]) : undefined,
      })),
    };
  }

  if (name === "proposeModelChanges") {
    return {
      kind: "proposal",
      status,
      label: String(args.label ?? "Proposed change"),
      commands: Array.isArray(args.commands) ? args.commands : [],
    };
  }

  if (name === "addBoardTile") {
    return { kind: "tile", status, boardSlug: String(args.boardSlug ?? ""), spec: args.spec };
  }

  return null;
}
