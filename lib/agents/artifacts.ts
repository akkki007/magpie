import type { PendingAction } from "./run";

/**
 * What a run has on its canvas (`docs/agents-plan.md` A5).
 *
 * The left pane shows *the work*, not a description of it: the table being designed with its
 * real columns, the rows the agent actually sampled, the series it actually rolled up. You
 * approve — and follow along — by looking at the thing.
 *
 * Two kinds of card live in one ordered list:
 *
 * - **Builds** (`table`, `proposal`, `tile`) are writes. They are recorded when the graph
 *   halts to ask, and *updated in place* as they are approved, created, declined or refused.
 * - **Views** (`outline`, `records`, `series`) are reads. They are emitted by the tools
 *   themselves as they return, which is what makes the canvas live for the 90% of a run
 *   that reads rather than writes. Before this, the canvas sat empty saying "nothing built
 *   yet" through a minute of real work, and only lit up at the approval gate.
 *
 * **Stored on the run, not derived from `pending`.** `pending` is cleared on approval, so a
 * card derived from it vanished the instant it became real — the one moment a person most
 * wants to look at what they just allowed. A record of the work has to outlive the decision
 * about it.
 */

export type ArtifactStatus = "proposed" | "created" | "declined" | "failed" | "read";

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
  /** Each command as a sentence, with real variable and period names. */
  lines: string[];
  commands: unknown[];
};

export type TileDraft = {
  kind: "tile";
  status: ArtifactStatus;
  boardSlug: string;
  title: string;
  summary: string;
  spec: unknown;
};

/** The model, as an outline: what a person would see if they opened the plan. */
export type OutlineView = {
  kind: "outline";
  status: "read";
  name: string;
  horizon: string;
  groups: { name: string; variables: { name: string; kind: string; formula?: string }[] }[];
};

/** Real rows out of a real table — what `sampleTable` returned, drawn as the grid it is. */
export type RecordsView = {
  kind: "records";
  status: "read";
  slug: string;
  name: string;
  columns: { name: string; type: string }[];
  rows: (string | number | null)[][];
  showing: number;
  total: number;
};

/**
 * How to *re-derive* a series, so it can be pinned to a board.
 *
 * **A reference, never the numbers.** `docs/board-plan.md` §0 is that a board owns no
 * numbers: a tile is a reference plus a form, and it resolves on every render. Pinning the
 * values drawn on the canvas would create exactly the fourth place a figure can come from
 * that the rule exists to prevent — and it would be the one on the wall, so it would be the
 * one people believed the first time it disagreed with the model.
 *
 * Absent when the series cannot be expressed as one: a scenario or a single dimension member
 * is a different quantity from the variable a tile would reference, and a tile carries
 * neither. Those cards simply do not offer a pin, which is the honest outcome.
 */
export type SeriesRef =
  | { kind: "model"; variableIds: string[] }
  | {
      kind: "database";
      tableSlug: string;
      dateFieldId: string;
      valueFieldId: string | null;
      aggregation: "SUM" | "COUNT" | "AVG";
      breakdownFieldId: string | null;
    };

/** A series over the model's periods, from the plan or rolled up from records. */
export type SeriesView = {
  kind: "series";
  status: "read";
  title: string;
  source: "model" | "records";
  format: "CURRENCY" | "COUNT" | "PERCENT" | "RATIO";
  periods: string[];
  series: { label: string; values: number[] }[];
  note?: string;
  /** Set when this chart can become a board tile. See `SeriesRef`. */
  ref?: SeriesRef;
};

/**
 * The union *without* its key, so a factory can return one member of it.
 *
 * `Omit<Artifact, "key">` looks equivalent and is not: `Omit` on a union collapses it to the
 * properties every member shares, losing the fields that make each card renderable.
 */
export type Draft = TableDraft | ProposalDraft | TileDraft | OutlineView | RecordsView | SeriesView;

/**
 * Keyed by what the card is *of*, which is how a second look updates it instead of stacking.
 *
 * `cited` marks the one card the run's answer pointed at, so the conversation can draw it
 * beside the finding. Set from `submitFinding`'s `chart`, which is grounded against the keys
 * actually shown — the agent chooses which chart carries its point, and cannot choose one it
 * never looked at.
 */
export type Artifact = Draft & { key: string; at: string; cited?: boolean };

type Args = Record<string, unknown>;

/**
 * How many cards the canvas keeps.
 *
 * A long run reads a lot; a canvas that grows without bound turns into a scroll-back the
 * person has to hunt through, which is the opposite of "what is happening now". Builds are
 * never dropped — they are the run's output, and there are at most a handful. Only the
 * oldest *views* are evicted.
 */
const MAX_CARDS = 14;

const isView = (a: Artifact) => a.status === "read";

function trim(cards: Artifact[]): Artifact[] {
  if (cards.length <= MAX_CARDS) return cards;
  const out = [...cards];
  while (out.length > MAX_CARDS) {
    const oldest = out.findIndex(isView);
    if (oldest < 0) break;
    out.splice(oldest, 1);
  }
  return out;
}

/**
 * Put a card on the canvas, replacing any card of the same thing **in place**.
 *
 * In place, not appended: re-reading a table the agent already looked at should refresh that
 * card where it sits, not make the canvas jump. Position is stability, and a canvas that
 * reorders itself while you read it is unusable.
 */
export function show(existing: Artifact[], key: string, draft: Draft): Artifact[] {
  const card = { ...draft, key, at: new Date().toISOString() } as Artifact;
  const at = existing.findIndex((a) => a.key === key);
  if (at < 0) return trim([...existing, card]);

  const out = [...existing];
  out[at] = card;
  return out;
}

/**
 * Append newly-proposed writes, leaving anything already recorded alone.
 *
 * Keyed by the same signature the declined-ledger uses, so a re-proposal of the identical
 * thing updates its card rather than stacking a duplicate beside it.
 */
export function recordProposed(
  existing: Artifact[],
  pending: PendingAction[],
  key: (a: PendingAction) => string,
  naming: Naming,
): Artifact[] {
  let out = existing;
  for (const action of pending) {
    const draft = fromArgs(action.name, action.args as Args, naming);
    if (draft) out = show(out, key(action), draft);
  }
  return out;
}

/** Which card a write tool produces — the two are separate vocabularies on purpose. */
const KIND_OF: Record<string, Draft["kind"]> = {
  createTable: "table",
  proposeModelChanges: "proposal",
  addBoardTile: "tile",
};

/**
 * Move cards awaiting a decision to `status`.
 *
 * **Scoped to the tool that settled, not applied to everything pending.** An interrupt
 * carries `actionRequests` as an array, so a run can be halted on two writes at once — and
 * the first one to come back would otherwise have marked the other one created too. Naming
 * the tool keeps each card's fate its own.
 *
 * Two *simultaneous* writes through the same tool still settle together, which is the
 * remaining imprecision here. Matching on arguments instead was tried and is worse: the
 * interrupt carries the model's raw arguments while the tool body sees them after Zod has
 * applied defaults, so the two do not always serialise alike, and a miss would leave a card
 * stuck on "awaiting approval" forever — a wrong label that never resolves, rather than one
 * that is right about what happened and vague about which of two identical calls did it.
 */
export function settle(
  existing: Artifact[],
  status: ArtifactStatus,
  detail?: { tool?: string; slug?: string },
): Artifact[] {
  const kind = detail?.tool ? KIND_OF[detail.tool] : undefined;

  return existing.map((artifact) => {
    if (artifact.status !== "proposed") return artifact;
    if (kind && artifact.kind !== kind) return artifact;
    return { ...artifact, status, ...(detail?.slug ? { slug: detail.slug } : {}) };
  });
}

/* ── Naming ───────────────────────────────────────────────────────────────
 *
 * A proposal's arguments are ids and period indices — `v_new_accounts`, period 6 — which is
 * exactly the wrong thing to put in front of someone deciding whether to allow it. The run
 * has the model, so the card carries "New Accounts · Jul 2026" instead. An id that cannot be
 * resolved is shown as itself rather than hidden; a card that quietly renamed an unknown
 * variable would be worse than one that looks unfamiliar. */

export type Naming = {
  variable(id: string): string;
  period(index: number): string;
  scenario(id: string): string;
};

export const RAW_NAMING: Naming = {
  variable: (id) => id,
  period: (index) => `period ${index}`,
  scenario: (id) => id,
};

export function describeCommands(commands: unknown[], naming: Naming): string[] {
  return commands.map((command) => describeCommand(command as Args, naming));
}

function describeCommand(c: Args, n: Naming): string {
  const variable = () => n.variable(String(c.variableId));
  const member = typeof c.member === "string" && c.member !== "TOTAL" ? ` (${c.member})` : "";

  switch (c.type) {
    case "SetInput":
      return `Set ${variable()}${member} · ${n.period(Number(c.period))} to ${c.value}`;
    case "RenameVariable":
      return `Rename ${variable()} to “${String(c.name)}”`;
    case "SetFormula":
      return c.formula === null
        ? `Clear the formula on ${variable()}`
        : `Give ${variable()} a new formula`;
    case "InsertVariable": {
      const added = c.variable as Args | undefined;
      return `Add a variable, ${String(added?.name ?? "unnamed")} (${String(added?.kind ?? "INPUT")})`;
    }
    case "RemoveVariable":
      return `Remove ${variable()}`;
    case "CreateScenario":
      return `Create the scenario “${String((c.scenario as Args | undefined)?.name ?? "unnamed")}”`;
    case "RenameScenario":
      return `Rename the scenario ${n.scenario(String(c.scenarioId))}`;
    case "DeleteScenario":
      return `Delete the scenario ${n.scenario(String(c.scenarioId))}`;
    case "SetOverride":
      return c.value === null
        ? `Clear ${variable()}'s override in ${n.scenario(String(c.scenarioId))}`
        : `Override ${variable()} in ${n.scenario(String(c.scenarioId))}`;
    default:
      return `${String(c.type ?? "Unknown command")}`;
  }
}

/** A tile spec, said in a sentence. The full spec is still on the card for anyone who wants it. */
function summariseTile(spec: unknown): { title: string; summary: string } {
  const s = (spec ?? {}) as Args;
  const title = String(s.title ?? s.label ?? "Untitled tile");

  if (s.kind === "text") return { title, summary: "A text tile" };

  const source = s.source as Args | undefined;
  const from =
    source?.type === "table"
      ? `records in ${String(source.tableSlug ?? "a table")}`
      : source?.type === "model"
        ? "the model"
        : "its source";

  if (s.kind === "kpi") return { title, summary: `A KPI from ${from}` };
  return { title, summary: `A ${String(s.form ?? "chart").replace("-", " ")} from ${from}` };
}

function fromArgs(name: string, args: Args, naming: Naming): Draft | null {
  if (name === "createTable") {
    const fields = Array.isArray(args.fields) ? (args.fields as Args[]) : [];
    return {
      kind: "table",
      status: "proposed",
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
    const commands = Array.isArray(args.commands) ? args.commands : [];
    return {
      kind: "proposal",
      status: "proposed",
      label: String(args.label ?? "Proposed change"),
      lines: describeCommands(commands, naming),
      commands,
    };
  }

  if (name === "addBoardTile") {
    return {
      kind: "tile",
      status: "proposed",
      boardSlug: String(args.boardSlug ?? ""),
      ...summariseTile(args.spec),
      spec: args.spec,
    };
  }

  return null;
}
