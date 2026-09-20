/**
 * The review queue's command bus (`docs/recon-plan.md` R5.2).
 *
 * The same shape as `lib/model/commands.ts`, for the same reason
 * (`docs/modelling-plan.md` §1.3): every mutation is a typed command that hands back the
 * command undoing it, so undo, the audit trail and — later — an agent accepting a batch on
 * your behalf are **one mechanism rather than three**.
 *
 * It runs against in-memory state today. A controller's decisions do not survive a reload,
 * and that is stated on the screen rather than hidden: recon has no tables yet, the same gap
 * M0 closes for modelling. When they land, these commands are what gets persisted, in order,
 * and nothing above this file changes.
 */

export type QueueStatus = "open" | "accepted" | "rejected";

/** Entry id → what a human decided about it. Absent means open. */
export type QueueState = Record<string, QueueStatus>;

export type QueueCommand =
  /** Accept or reject one entry, or every entry in a class (R5.3). */
  | { type: "Resolve"; ids: string[]; to: Exclude<QueueStatus, "open">; scope: string }
  /** The inverse: put the listed entries back exactly as they were. */
  | { type: "Restore"; states: QueueState; scope: string };

export type QueueCommandResult = {
  state: QueueState;
  inverse: QueueCommand;
  /** Written for the audit trail and the undo button, so it names the effect. */
  label: string;
};

export function applyQueueCommand(state: QueueState, command: QueueCommand): QueueCommandResult {
  switch (command.type) {
    case "Resolve": {
      const next = { ...state };
      // The inverse captures the *prior* status of each id, not a blanket "open" — undoing a
      // bulk accept that ran over a partly-reviewed class has to restore the exceptions too.
      const previous: QueueState = {};
      for (const id of command.ids) {
        previous[id] = state[id] ?? "open";
        next[id] = command.to;
      }
      return {
        state: next,
        inverse: { type: "Restore", states: previous, scope: command.scope },
        label:
          command.ids.length === 1
            ? `${command.to === "accepted" ? "Accepted" : "Rejected"} one match in ${command.scope}`
            : `${command.to === "accepted" ? "Accepted" : "Rejected"} ${command.ids.length} matches in ${command.scope}`,
      };
    }

    case "Restore": {
      const next = { ...state };
      const previous: QueueState = {};
      for (const [id, status] of Object.entries(command.states)) {
        previous[id] = state[id] ?? "open";
        if (status === "open") delete next[id];
        else next[id] = status;
      }
      return {
        state: next,
        inverse: { type: "Restore", states: previous, scope: command.scope },
        label: `Restored ${Object.keys(command.states).length} entry(ies) in ${command.scope}`,
      };
    }
  }
}
