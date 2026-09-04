/**
 * The three ways to run an agent (`docs/agents-plan.md` A5).
 *
 * **These gate tools, they do not just change the prompt.** A mode selector that only
 * rephrases an instruction is decoration — the agent can still reach every tool, so "Ask"
 * would be a promise the graph does not keep. Each mode removes capability, which is the
 * only version of this that is worth putting on screen.
 */

export type Mode = "ask" | "plan" | "do";

export const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "ask", label: "Ask", hint: "Read and answer. Cannot change anything." },
  { value: "plan", label: "Plan", hint: "Work out what it would do, and stop before doing it." },
  { value: "do", label: "Do", hint: "Carry it out — each change stops for your approval." },
];

export function toolsFor(mode: Mode, write: readonly string[]): readonly string[] {
  // Ask and Plan both hold no write tools at all. The difference between them is what the
  // agent is asked to produce, not what it can reach — which is why Plan is safe to leave
  // unattended and Do is not.
  return mode === "do" ? write : [];
}

/**
 * The "you did not do it" clause, on both read-only modes.
 *
 * Necessary, and learned the hard way: in ask mode — with no write tools at all — the agent
 * was asked to create a table, wrote a *file* describing one, and reported "I have
 * successfully created a database table for tracking office expenses." Nothing was created;
 * the table count was unchanged. The gate held perfectly and the answer still lied, which is
 * worse than a refusal, because a person reads the sentence and not the database.
 *
 * The same failure the modelling agent had when it narrated a scenario it never proposed.
 *
 * **Necessary and not sufficient — this clause alone did not hold.** A later live run in ask
 * mode answered "I have created a database table for tracking office expenses with columns
 * for date, category, amount…" with all of the above in its prompt. Which is this file's own
 * opening argument turned on itself: a mode that only rephrases an instruction is decoration,
 * and so is a rule against lying that is only ever asked for. The enforcement now lives in
 * `submitFinding` (`lib/agents/tools.ts`), which refuses a finding that claims a write when
 * the mode holds no tool that could have made one. The prose stays because a model that is
 * told the rule up front needs the refusal less often.
 */
const NOT_DONE = `You have NO tools that change anything in this mode. So:

- Never say you created, added, updated, built or set up anything. You did not.
- Writing a file describing a table is not creating a table. Describing a change is not
  making one. If you find yourself about to write "I have created", stop: the correct
  sentence is "here is what I would create — switch to Do mode and I will propose it".
- If the task asked you to build something, say plainly that this mode cannot, give the
  design you would use, and say what switching modes would get them.`;

const GUIDANCE: Record<Mode, string> = {
  ask: `MODE: ASK. You are answering a question. Answer what was asked, with the numbers you
read, and stop. If the honest answer is "the data does not cover this", say that.

${NOT_DONE}`,

  plan: `MODE: PLAN. Work out what *should* be done and lay it out. Read what you need, then set
out the specific change you would make — which variables, which values, which columns —
precisely enough that a person could approve it or carry it out themselves.

${NOT_DONE}`,

  do: `MODE: DO. Carry the task out. You have write tools, and each one halts for a person's
approval before it runs, so state what you are doing and then do it — do not ask permission
in prose first, and do not stop at describing the change when you were asked to make it.`,
};

export const modeGuidance = (mode: Mode) => GUIDANCE[mode];
