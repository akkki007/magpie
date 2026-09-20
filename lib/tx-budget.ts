/**
 * How long an interactive transaction may take, and how long it may wait for a connection.
 *
 * Prisma's defaults — 5s and 2s — are sized for a Postgres on the same machine, where a
 * round trip costs ~0.1ms and a loop of a few hundred of them disappears. Against a managed
 * database in another region a round trip costs ~200ms, and the same loop blows the budget:
 * the transaction dies with `P2028` partway through and nothing is written.
 *
 * Batching is the real fix and is applied wherever it can be — see the `createMany` in
 * `lib/model/persist.ts`. But some loops cannot be batched, because each step needs the
 * previous step's result: a command's inverse is read against whatever the command before it
 * left behind, so `persistCommands` and `acceptProposal` are sequential by nature. This is
 * what covers those.
 *
 * Deliberately one constant rather than a literal at each call site. The right deadline is a
 * property of *where the database is*, not of what any individual transaction happens to do,
 * so a caller that picks its own number is a caller that will be wrong the next time the
 * database moves.
 *
 * It lives in its own module rather than in `lib/db.ts` because `lib/db.ts` builds the
 * client the moment it is evaluated, and throws if `DATABASE_URL` is unset. The two
 * `persist.ts` files take their client as a parameter precisely so they do not depend on
 * that singleton; importing a constant from it would quietly hand the dependency back.
 *
 * Note this is a ceiling, not a reservation: a transaction that finishes in 20ms still
 * finishes in 20ms. The cost of a generous ceiling is only that a genuinely stuck
 * transaction holds its row locks longer before giving up.
 */
export const TX_BUDGET = { timeout: 120_000, maxWait: 30_000 } as const;
