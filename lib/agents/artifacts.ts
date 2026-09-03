import type { PendingAction } from "./run";

/**
 * What a run has produced, for the canvas (`docs/agents-plan.md` A5).
 *
 * The left pane shows *the work*, not a description of it: the table being designed, with
 * its real columns, while the run is still deciding whether to ask for it. That is the
 * difference between an approval screen and a diff — you are looking at the thing, and the
 * chat beside it is the conversation about the thing.
 *
 * **Stored on the run, not derived from `pending`.** The first version read the pending
 * action, which is right up until the moment it matters: `pending` is cleared on approval,
 * so the table card appeared while permission was being asked and vanished the instant it
 * was granted — the one point at which a person most wants to look at what they just
 * allowed. A record of the work has to outlive the decision about it, so each artifact is
 * appended when it is proposed and then *updated in place* as it is approved, created or
 * declined.
 */

export type ArtifactStatus = "proposed" | "created" | "declined" | "failed";

export type TableDraft = {
  kind: "table";
  status: ArtifactStatus;
  /** Set once the table really exists, so the canvas can link to it. */
  slug?: string;
  name: string;
  description?: string;
  fields: { name: string; type: string; options?: string[] }[];
};

export type ProposalDraft = {
  kind: "proposal";
  status: ArtifactStatus;
  label: string;
  commands: unknown[];
};

export type TileDraft = {
  kind: "tile";
  status: ArtifactStatus;
  boardSlug: string;
  spec: unknown;
};

/**
 * The union *without* its key, so `fromArgs` can return one member of it.
 *
 * `Omit<Artifact, "key">` looks equivalent and is not: `Omit` on a union collapses it to the
 * properties all three members share, which is `kind` and `status` — losing the fields that
 * make each card renderable.
 */
type Draft = TableDraft | ProposalDraft | TileDraft;

/** Keyed by tool name plus arguments, which is how an update finds the card it belongs to. */
export type Artifact = Draft & { key: string };

type Args = Record<string, unknown>;

/**
 * Append newly-proposed writes, leaving anything already recorded alone.
 *
 * Keyed by the same signature the declined-ledger uses, so a re-proposal of the identical
 * thing updates its card rather than stacking a duplicate beside it.
 */
export function recordProposed(existing: Artifact[], pending: PendingAction[], key: (a: PendingAction) => string): Artifact[] {
  const out = [...existing];

  for (const action of pending) {
    const signature = key(action);
    const artifact = fromArgs(action.name, action.args as Args, "proposed");
    if (!artifact) continue;

    const at = out.findIndex((a) => a.key === signature);
    const card = { ...artifact, key: signature } as Artifact;
    if (at >= 0) out[at] = card;
    else out.push(card);
  }

  return out;
}

/** Move every card still awaiting a decision to `status`. */
export function settle(existing: Artifact[], status: ArtifactStatus, detail?: { slug?: string }): Artifact[] {
  return existing.map((artifact) =>
    artifact.status === "proposed" ? { ...artifact, status, ...(detail ?? {}) } : artifact,
  );
}

function fromArgs(name: string, args: Args, status: ArtifactStatus): Draft | null {
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
