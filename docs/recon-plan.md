# Magpie — Reconciliation Slice

> **For Razorpay Hackathon Track 04 — AI Finance Controller.**
>
> The track's bar, quoted, because every decision below is downstream of it:
>
> > Build an agent that closes one finance-ops loop across a 50+ record batch of synthetic
> > data, reporting its match rate and the exceptions it could not resolve.
> > **Throughput plus measured accuracy plus an honest exception list. One cherry-picked
> > match proves nothing.**
>
> Status (2026-08-31): **R0 through R3 are built** — the cut line in §4 is cleared.
> `recon:seed` emits a deterministic batch plus its answer key, `recon:ingest --verify`
> reads it back, `recon:match` reconciles it with no model involved anywhere, and
> `recon:eval` scores the run against the key:
>
> | File | What it is |
> |---|---|
> | `lib/recon/money.ts` | Integer paise, and the Indian-grouping formatter |
> | `lib/recon/random.ts` | Seeded RNG — same seed, byte-identical batch |
> | `lib/recon/types.ts` | Canonical records, failure classes, the truth schema |
> | `lib/recon/generate.ts` | Builds a clean world, then damages it on purpose |
> | `lib/recon/csv.ts` | CSV writing, including the deliberate messes |
> | `lib/recon/parse.ts` | RFC 4180 parser, and decoders that refuse rather than coerce |
> | `lib/recon/ingest.ts` | Seven source schemas → canonical records + typed rejections |
> | `lib/recon/tolerance.ts` | Every allowance the matcher may make, named, in one file |
> | `lib/recon/candidates.ts` | Indexes, edit distance, and the bounded subset search |
> | `lib/recon/match.ts` | The tiered deterministic matcher and its `MatchResult` |
> | `lib/recon/score.ts` | Precision and recall, measured in opposite directions |
> | `scripts/recon-seed.ts` | Seeder, with its own integrity check |
> | `scripts/recon-ingest.ts` | Rows in / records out / rejected, cross-checked against truth |
> | `scripts/recon-match.ts` | Per-tier counts, timing, and the exception queue |
> | `scripts/recon-eval.ts` | The scoreboard, and a self-check that it can fail |
>
> Default run: 5,000 payments → **11,258 records** across seven files, **79 planted
> failures across all 18 classes** plus 5 deliberately malformed rows, 456 links to score.
> `recon:eval` scores the deterministic run at:
>
> | | |
> |---|---|
> | Auto-apply precision | **100%** |
> | False-match rate | **0%** |
> | Match rate | **98.6%** — 100% on the payments and ledger lanes, 95.8% on the bank lane |
> | Coverage including proposals | **100%** |
> | Exception recall | **100%** (31 of 31) |
> | Class accuracy | **92.4%** (73 of 79) |
> | Escalation rate | **8.1%** — 6 proposals, 31 exceptions |
> | Wall clock | ~200 ms end to end, no model involved |
>
> The 1.4% and the 7.6% are **deliberate, and they are R4's job.** Six links are cases no
> rule can settle safely (R0.5): a payout under a mangled counterparty name, a payout
> described in prose, each a few paise out with no reference. The deterministic tiers rank
> the candidates, put the correct settlement first in all six, and decline — so R4's ceiling
> is a number that exists before the model does: match rate to 100% and class accuracy to
> 100%, *only* if precision stays at 100%. That is the §A8 ablation.
>
> **R5 is built** — `/recon` renders the queue, grouped by class and sorted by cash impact,
> with bulk accept/reject per class and undo through a command bus. **R4 is built and
> unproven.** The adjudication tier, its validation gate and the ablation
> harness all exist; the gate's ten rejection paths are exercised by `recon:agent --dry-run`
> with no key and no network. The live path has never run — there is no API key on this
> machine — so the scoreboard above is still the deterministic one and no claim is made about
> a model. One live run turns the headroom into a verdict. The modelling engine this ends in
> is built: `docs/modelling-plan.md`.

---

## 0. The loop, in one sentence

**Payments → settlements → bank credits → books**, matched three ways, with everything the
matcher could not resolve raised as a typed exception, and the resolved cash driving the
forward cash position in the existing grid.

That hits two of the track's four example directions (multi-source reconciliation, forward
cash forecaster), it is the Razorpay-native problem, and it ends in a screen we already
have. **One loop, closed, measured.** Not six agents.

```
 Razorpay payments ─┐
 refunds            ├─► settlement batch ──► bank credit (UTR) ──► ledger entries
 chargebacks        │        │                     │                    │
 fees / TDS ────────┘        └──── match 1 ────────┴──── match 2 ───────┘
                                       │                     │
                                       └──► exceptions ◄─────┘
                                                 │
                                    reconciled + in-flight cash
                                                 │
                                    ►  Cash position model (built)
```

---

## 1. Decisions

### 1.1 The agent is not the matcher

Deterministic passes do the matching. The LLM only sees what deterministic rules could not
resolve, and its job is **adjudication and explanation**, never arithmetic.

*Why:* three separate reasons, and any one of them is sufficient.

- **Accuracy.** A rule that matches on `UTR + amount + date window` is right 100% of the
  time or wrong in a way you can debug. A model asked to compare 5,000 amounts will be
  right ~99% of the time in a way you cannot.
- **Economics.** 5,000 records through an LLM is slow and expensive; 5,000 records through
  rules with 120 ambiguous ones escalated is neither.
- **The story.** "The agent knows when to defer" is a stronger claim to a judge than "the
  agent did everything", and it is the claim the track's bar is actually testing.

### 1.2 Every match carries its evidence

A match is never a boolean. It is `{ rule, confidence, evidence[], inputs[] }` — which pass
produced it, what it compared, and what it compared it against. This is what makes the
exception list *honest* rather than a list of things the code crashed on, and it is what a
reviewer needs to accept or reject in two seconds.

### 1.3 Three outcomes, never two

`AUTO_MATCHED` · `PROPOSED` (needs a human) · `EXCEPTION` (typed, with a reason).

**Abstention is a success state.** Precision on auto-apply is the metric that matters: a
wrong match silently corrupts the books, an exception merely costs a minute. Tune the
thresholds so the auto-apply lane is near-perfect and let recall be handled by the queue.

### 1.4 The agent proposes; it never writes

Same rule as the modelling module (`docs/modelling-plan.md` §1.4), and the same mechanism:
an agent run produces a changeset of commands in `PROPOSED`. Accepting applies them,
rejecting drops them, and the command stream is the audit log.

*This is the part of the architecture that already fits the track's bar* — "the exceptions
it could not resolve" is a low-confidence proposal queue, which we designed before we had a
reason to.

### 1.5 The scoreboard is a feature, not a report

Match rate, precision, false-match rate, throughput and cost are rendered in the product,
from a labelled run, live. A beautiful workspace with no numbers about its own accuracy
loses to an ugly CLI that prints a confusion matrix.

### 1.6 Synthetic data is designed, not generated

The dataset is authored with **planted, labelled failure modes** and a ground-truth answer
key. Data with no hard cases proves nothing, and an exception list that comes back empty is
evidence of a bad dataset, not a good agent.

---

## 2. How the agent should work

The design I would defend in front of a judge.

**A1 — Tiered pipeline, escalating cost.** Each tier only sees what the previous could not
resolve:

| Tier | Method | Expected share |
|---|---|---|
| T0 | Exact: `UTR + amount + currency` | ~70% |
| T1 | Tolerance: amount ± fees/TDS, date ± settlement window | ~15% |
| T2 | Structural: one-to-many and many-to-one (split and combined credits), subset-sum over a bounded candidate set | ~8% |
| T3 | **LLM adjudication** over the ranked candidates T2 produced | ~5% |
| T4 | Exception, typed | remainder |

T3 never searches the whole dataset. Deterministic code hands it **at most 5 candidates
with their evidence**, and it picks one or declines. That single constraint is what keeps
accuracy, cost and latency all in range.

**A2 — Narrow tools, no prose.** The model gets `getRecord`, `findCandidates`,
`proposeMatch`, `flagException` — and nothing that writes. Tool schemas come from the same
Zod definitions that validate commands from the UI, so there is one definition of a legal
mutation (`docs/modelling-plan.md` §5).

**A3 — Structured output, validated, or it is an exception.** Anything that fails schema
validation, references a record id that does not exist, or proposes an amount that does not
tie is dropped into the exception lane. A malformed proposal must never become a silent
pass.

**A4 — Arithmetic in code, judgment in the model.** The model may say *"this bank credit is
these two settlements minus a chargeback"*; the sum is then computed and checked in
TypeScript. If the arithmetic does not tie to the paisa, the proposal is rejected
regardless of how confident the model sounded.

**A5 — Explanations for humans, not transcripts.** One line per exception: what it expected,
what it found, what it would take to resolve. "Bank credit ₹4,82,119 on 12 Mar has no UTR;
nearest settlement is ₹4,82,119 on 11 Mar (`setl_9f2`) — amount and date tie, reference is
missing." That is what a controller acts on. Nobody wants the chain of thought.

**A6 — Batch, cache, and never call per record.** Group escalations into batched calls,
cache the ledger and schema context across the run, and hold p95 latency per escalated
record as a tracked number.

**A7 — Grounding rules.** The model may only reference ids present in the candidate set it
was given. No invented `payment_id`, ever. Validate before the proposal reaches the UI —
same rule as a formula that does not compile never reaching the grid.

**A8 — The ablation is the money slide.** Run the same labelled batch three ways:
deterministic-only, deterministic + LLM, LLM-only. The expected result — rules are fast and
precise, LLM-only is slow and worse, the hybrid wins on match rate at equal precision — *is
the argument for the whole design*, and it takes an afternoon to produce.

---

## 3. Tasks

### R0 — The dataset and its answer key

**R0.1 — Canonical record types** — `Payment`, `Refund`, `Chargeback`, `Settlement`,
`SettlementLine`, `BankCredit`, `LedgerEntry`. Money as integer paise, never float.
*Done when:* the types compile and a fixture of ten records round-trips.

**R0.2 — Generator with a ground truth key** — `bun run recon:seed --count 5000` emits the
batch plus `truth.json`: for every record, the match it *should* land in, or the exception
class it *should* raise.
*Done when:* regenerating with the same seed produces identical output. Determinism is
non-negotiable — an eval you cannot reproduce is not an eval.

**R0.3 — Plant the failure modes**, each with a labelled class and a target share:

| Class | What it is |
|---|---|
| `MISSING_UTR` | Bank line with no reference |
| `TYPO_UTR` | Transposed characters in the reference |
| `SPLIT_SETTLEMENT` | One settlement lands as two credits |
| `COMBINED_CREDIT` | One credit covers two settlements |
| `FEE_NOT_BOOKED` | Gross vs net, fee and GST unposted |
| `TDS_WITHHELD` | Amount short by exactly TDS |
| `TIMING_T_PLUS_N` | Credit lands after a weekend or holiday |
| `REFUND_NETTED` | Refund deducted inside a settlement |
| `CHARGEBACK_DEDUCTION` | Dispute debited against a batch |
| `DUPLICATE_CREDIT` | The same credit ingested twice |
| `FOREIGN_CREDIT` | A bank line that is not Razorpay at all |
| `ROUNDING_PAISE` | Off by one or two paise |
| `MISSING_LEDGER_ENTRY` | Settled but never posted to books |

*Done when:* each class is present, counted, and the totals are printed by the seeder.
*Respect:* §1.6 — if the matcher scores 100%, the dataset is too easy, not the agent good.

**R0.4 — The settlement recon report.** *Added after R3, because R3 measured the hole.*

The payments export carries no settlement id, so the payments lane had no reference on
either side and the payout calendar was the only join. That proves a *date* ties out and can
never say which of eight same-day payouts a payment belongs to — 10^23 partitions, all of
which the arithmetic accepts. The matcher recovered 12 of 147 links, guessed nothing, and
was permanently capped there: R4's model cannot derive information the files do not contain.

Razorpay publishes a per-payment settlement recon report, so the dataset now emits one —
`recon.csv`, one row per settled entity, naming the payout it landed in and the UTR it was
paid under. A matcher that needs it is not being given a hint; a dataset that omits it was
the thing being unrealistic. The lane went from **8.2% to 100%**, and the overall escalation
rate from 35.1% to 6.8%.

Two classes are planted in the new file, and `MISSING_RECON_ROW` is planted in **two shapes
with two different answers** on purpose:

| Shape | Why the key expects what it does |
|---|---|
| One payout omitted on a date | Every other payout that day is itemised, so its payments are the exact remainder — recoverable **by elimination**, so `MATCH` |
| Two payouts omitted on one date | Eighty payments, two payouts of forty, nothing to tell them apart — `EXCEPTION` |
| `MISATTRIBUTED_PAYMENT` | One payment traded between two same-day payouts: the count still ties and the value does not, so a matcher checking cardinality alone accepts it silently |

*Done when:* the lane matches on a reference rather than a calendar, and the calendar becomes
an independent second derivation rather than the only one.

**R0.5 — Plant genuine ambiguity.** *Built.* The batch was fully solvable by deterministic
rules, and §1.6 says that is a statement about the dataset: with nothing escalated, an
adjudication tier cannot beat rules-only and the ablation shows three identical bars.

Three classes, split by the distinction that decides whether something is R2's problem or
R4's:

| Class | Who should resolve it, and why |
|---|---|
| `UTR_IN_NARRATION` | **A rule.** Banks put the UTR in the narration and leave the reference column empty constantly. That is a reference filed in the wrong place, not an ambiguity — so `T1_NARRATION_REFERENCE` was written for it and it matches at 0.94. |
| `DISGUISED_COUNTERPARTY` | **Judgement.** A real payout whose narration never spells the gateway recognisably — `RZPSPL`, `R P SOFTWARE PVT LTD`, `RAZOR PAY SW`, `RAZORPY SOFTWRE`. No reference, amount a few paise out. |
| `NARRATED_PAYOUT` | **Judgement.** No reference at all; the narration gives the transaction count and date in prose, sometimes as a numeral and sometimes spelled out. |

The honest statement of why the last two are not rules: **they are individually resolvable,
but only by widening a tolerance until it makes silent false matches.** Allow rounding with
no reference at all and these six links appear — along with, on a real month's statement, the
occasional marriage of two unrelated payouts of similar value, which §6 names the worst
failure in the system precisely because nobody sees it. So the tiers narrow, rank and stop.

Every instance is worded differently on purpose. One template is a regex waiting to be
written; bank narrations vary without limit, and that variation is the thing a model handles
and a pattern does not.

*Done when:* the deterministic run escalates rather than guesses, and the headroom a
judgement tier could close is a measurable number. It is: 6 links, correct candidate ranked
first in all 6, printed by `recon:eval` on every run.

### R1 — Ingest and normalise### R1 — Ingest and normalise

**R1.1 — CSV ingestion** for each source (payments export, settlement report, bank
statement, ledger), tolerant of the real messes: BOM, quoted commas, `dd/mm/yyyy`, `1,23,456.78`.
**R1.2 — Normalisation into the canonical types**, with every parse failure recorded as an
ingestion exception rather than dropped.
**R1.3 — A `Batch` record** — a run over a set of files, with counts and a status.
*Done when:* the 5,000-record synthetic batch ingests with a printed reconciliation of
"rows in / records out / rows rejected".
*Built.* One addition to the plan as written: the seeder now plants five malformed bank
rows (R0), because a rejection path that never executes is a rejection path nobody has
tested. Ingestion must reject exactly those five, and the CLI checks that against the
answer key.

### R2 — The deterministic matcher

**R2.1 — Candidate generation** — index by amount bucket, date window and reference, so
matching is not O(n²). This is what makes throughput a number worth reporting.
**R2.2 — T0 and T1 passes** — exact, then tolerance with fee/TDS/rounding allowances.
Tolerances are named config, not magic numbers scattered in the code.
**R2.3 — T2 structural pass** — one-to-many and many-to-one, subset-sum bounded to
candidates inside the window. Cap the search and record when the cap was hit.
**R2.4 — `MatchResult`** — `{ rule, confidence, evidence[], inputs[], outcome }` per §1.2.
*Done when:* the matcher runs the full batch and prints per-tier counts and timing.
*Respect:* §1.1 — no model is involved anywhere in this task.

*Built.* Eighteen named rules across four tiers; `lib/recon/tolerance.ts` holds every
allowance and every confidence, and one function turns a confidence into `AUTO_MATCHED` or
`PROPOSED` so the auto-apply lane cannot acquire a rule by accident. Three deviations from
the plan as written, each for a reason:

- **No amount buckets.** Buckets answer "what is near this amount", and near is fuzzy.
  Every tolerance here is a *computable* delta instead — ±5 paise, or exactly 1% of gross —
  so the query is a handful of exact hash probes. Faster, and it cannot silently widen.
- **A debit can be a settlement.** When a day's refunds exceed its payout the gateway
  settles a negative amount and the bank row is a debit carrying the correct UTR. The first
  version claimed every debit as an exception up front and turned two matchable settlements
  into four exceptions. Sign is not evidence; the reference passes run first now.
- **`inputs[]` may be summarised, `left`/`right` may not.** Capping a forty-payment batch to
  twenty-five ids still printed a confident match, and was simply the wrong link — §6's
  worst failure arriving through the reporting code rather than through a rule.

*Two rules added by R0.5.* `T1_NARRATION_REFERENCE` finds a UTR buried anywhere in a
narration by normalising both sides and testing containment — which survives every way a
bank mangles a reference, where a token pattern needs one pattern per gateway and still loses
to the next bank's formatting. `T2_ESCALATION_CANDIDATES` is the packet §A1 promises the model
tier: at most five ranked candidates with their gaps, dates and references, and **no
decision**. It also fixed a queue bug — an escalated credit was arriving in the queue three
times, once as a proposal, once as an unexplained credit and once as its settlement never
being banked, inflating cash-at-risk threefold.

**One finding that belonged to R0, now fixed.** The payments lane had no reference on either
side and was capped at 8.2% by the data rather than by the matcher — the whole argument is in
R0.4. With `recon.csv` the lane is a reference join like the other two and sits at 100%.

Two bugs found while fixing it, both the same mistake:

- **The sign of an amount is not evidence.** A payout whose refunds exceeded its takings
  settles *negative* and arrives as a bank debit — carrying the correct UTR. Passes that
  guarded on `amount > 0` silently excluded it.
- **A catch-all runs last.** Removing that guard from the near-miss pass changed nothing,
  because the debit pass still ran *before* it and had already claimed the row. The second
  instance carried a transposed UTR too, so it needed the near-miss pass specifically. Only
  the structural pass still assumes positive amounts, and it says so.

### R3 — Metrics, before the agent

**Build this before R4.** Everything after is tuning, and tuning without a scoreboard is
guessing.

**R3.1 — Score against `truth.json`** — match rate, precision, recall, **false-match rate**
(the number that actually matters), and per-exception-class accuracy.
*One scoring rule R2 forced:* a duplicated bank row is byte-identical to its original, so
which of the pair is "the duplicate" is undecidable. The matcher keeps the lower id and says
so; the scorer must treat the pair as unordered or it will report a false match that is not
one.
**R3.2 — Throughput and cost** — records/sec, wall clock, LLM calls, tokens, ₹ per 1,000
records, p50/p95 latency per escalated record.
**R3.3 — `bun run recon:eval`** — prints a confusion matrix and writes a run report to
disk.
*Done when:* one command produces the numbers that go on the submission slide.

*Built.* `bun run recon:eval` prints the headline, a per-lane table, the confusion matrix,
every false match in full, per-class accuracy, and throughput; it writes
`data/recon/eval-report.json`, whose `queue` array is what R5 renders.

Three things the build settled:

- **Precision and recall are measured in opposite directions**, and conflating them is how
  a match rate becomes a lie. Recall walks the answer key and asks what the matcher did
  with each link; precision walks the auto-applied results and asks whether the key backs
  them. A link never produced cannot help recall; a result never claimed cannot hurt
  precision.
- **Only an `AUTO_MATCHED` result can be a false match.** Scoring a proposal as a wrong
  answer would punish exactly the abstention §1.3 is built to reward, so a proposal costs
  recall and can never cost precision. That is the incentive the whole design rests on.
- **`--self-check` exists because a perfect score is not evidence.** It promotes a wrong
  proposal to auto-apply, resolves an exception the key expects, and mislabels a correct
  match, then asserts the scoreboard moves in all three. R1 plants malformed rows for the
  same reason; a scorer whose failure path never runs is measuring nothing.

The one number to keep watching: **escalation rate**, now 6.8% against the ~5% §6 asks of an
LLM tier. It was 35.1% before R0.4, and the whole difference was the undecidable payments
lane — which is what a scoreboard is for. `recon:eval` prints the §1.6 warning itself when
every lane hits 100% and the proposal lane is empty, because that is the state the batch is
in now and a plan nobody re-reads is the wrong place to record it.

### R4 — The agent

**R4.1 — Tool schemas from Zod** — `getRecord`, `findCandidates`, `proposeMatch`,
`flagException`. Read-only plus proposals (§A2).
**R4.2 — The escalation loop** — T2's ranked candidates in, a decision out, batched per
§A6, with Claude via the AI SDK.
**R4.3 — Validation gate** — schema, id grounding, and arithmetic re-checked in TypeScript
before anything is shown (§A3, §A4).
**R4.4 — Exception classification** — the agent labels each unresolved item with a class
from R0.3 and one line of evidence (§A5).
**R4.5 — The ablation harness** — the same batch three ways (§A8).
*Done when:* the hybrid beats deterministic-only on match rate **without** raising the
false-match rate.

*The baseline is already measured*, which is the whole reason R3 came first. Deterministic
only: 100% precision, 0% false matches, 98.6% match rate, 92.4% class accuracy, 6 links
escalated with the correct candidate ranked first in all 6. R4 succeeds if match rate and
class accuracy reach 100% and precision does not move; it fails if it closes those six by
becoming willing to guess, and the false-match rate is what will say so.

*Built, and unproven.* Every part of the tier exists and everything that can be checked
without a provider has been. **The live path has never run — there is no API key on this
machine — so no accuracy claim is made and the "done when" above is not yet met.**

| File | What it is |
|---|---|
| `lib/recon/adjudicate.ts` | Zod schemas, the prompt, the validation gate, and the fold-back. **No SDK import.** |
| `lib/recon/openai.ts` | The only file that knows which vendor answers. Batched, structured output, usage and latency. |
| `scripts/recon-agent.ts` | `--dry-run` gate check, `--replay`, live. Writes a cassette. |
| `recon:eval --with-agent` | The ablation: both arms, one scorer. |

Four decisions worth recording.

**The provider is one file, and that boundary paid for itself immediately.** Everything that
decides whether the tier is *safe* — schema, prompt, gate — sits in `adjudicate.ts` with no
SDK import. This plan specified Claude; the keys available were OpenAI's; the swap touched
one file. A provider change must not be able to quietly alter what counts as an acceptable
match.

**Structured output, not a tool loop.** R4.1 asked for `getRecord` / `findCandidates` /
`proposeMatch` / `flagException` as tool schemas. A tool loop is the wrong shape here: §A1
already hands the model at most five candidates *with their evidence*, so `getRecord` and
`findCandidates` would only re-fetch what is in the prompt, and §A6 explicitly forbids a call
per record. So the escalations go up batched, and one structured reply comes back. The Zod
schemas survive as R4.1 intended — one definition, used both as the wire format the provider
enforces and as the parser the gate runs — and the model still cannot write anything.

**The gate has ten rejection paths and all ten are exercised on every machine.**
`recon:agent --dry-run` feeds it one deliberately broken answer per path: an invented
settlement id (§A7), a stated gap that disagrees with the records (§A4), an empty evidence
line, a match naming nothing, a decline naming something anyway, confidence below the
threshold, a missing answer, a candidate outside tolerance, and a decline. It needs no key and
no network, and it **writes no cassette** — a scripted answer must never be able to reach a
scoreboard. One check is unreachable in the real pipeline and kept anyway: the ranking pass
only offers candidates inside the tolerance, but the gate must not trust the packet builder,
because an invariant that depends on an upstream pass having filtered correctly is not an
invariant.

**Runs are recorded, so the ablation is free and reproducible.** A live run writes its raw
decisions to `data/recon/adjudications.json`; `--replay` and the ablation re-gate them rather
than trusting what was recorded, so tightening the gate shows up on the next replay instead of
being frozen into an old recording. This is the same argument as R0.2's seeded RNG: an eval
you cannot reproduce is not an eval.

*What remains:* one live run with a key, then `recon:eval --with-agent` for the verdict — which
prints REJECT if the match rate rises while the false-match rate does too. The hybrid arm's
plumbing was verified against a synthetic cassette (6 of 6 accepted, match rate 98.6% → 100%,
class accuracy 92.4% → 100%, precision and false-match rate unchanged), which proves the wiring
and says nothing whatsoever about a model.

### R5 — The review queue

**R5.1 — The exceptions screen** — grouped by class, sorted by cash impact, each row
carrying its evidence line. This is the product surface of the track's "honest exception
list".
**R5.2 — Accept / reject / reassign**, each writing through the command bus so the audit
trail and undo come free (`docs/modelling-plan.md` §1.3).
**R5.3 — Bulk actions per class** — "accept all 42 TDS-withheld matches" is the difference
between a demo and a tool.
**R5.4 — The run summary header** — match rate, records processed, exceptions outstanding,
live from R3.

*Built.* `/recon` — the rail's second live destination, alongside `/workspace`.

| File | What it is |
|---|---|
| `lib/recon/report.ts` | Typed reader for the run report the scoreboard writes |
| `lib/recon/queue-commands.ts` | The queue's command bus: typed commands, each returning its inverse |
| `components/recon/review-queue.tsx` | The screen — summary, groups, rows, bulk actions, undo |
| `app/(app)/recon/page.tsx` | The route, behind auth and behind `connection()` |

Four decisions.

**The screen renders the report; it does not re-run the pipeline.** The matcher decides, the
scorer measures, the screen renders. A page that re-matched per request would be a fourth
place the numbers could come from, and the first time it disagreed with `recon:eval` nobody
would know which to believe.

**`connection()` before reading the file, and this one would have shipped silently.** On
Next 16 synchronous I/O — `readFileSync` included — completes during *prerendering*, so the
queue would have been baked into static HTML at build time and every visitor would see
whichever run happened to be on disk when the build ran. `await connection()` stops
prerendering at that point and the `<Suspense>` boundary keeps the rest of the shell static.
The build output confirms it: `ƒ /recon`, server-rendered on demand. A reconciliation screen
showing a stale exception list is worse than one that is slow.

**Grouping and sorting are the argument, not decoration.** By class, because a controller
works one kind of problem at a time and thirteen chargeback debits is one decision rather
than thirteen. By cash impact within the class, because that is the order money gets found
in. And every row carries the evidence lines the matcher produced — §1.2 exists so a
reviewer can accept or reject without opening a second file.

**Decisions are in memory, and the screen says so.** Recon has no tables, the same gap M0
closes for modelling, so a reload resets the queue. Every decision is already a typed command
carrying its inverse — undo works, and the labels read like an audit trail — so persisting
them is a storage change rather than a rewrite. Hiding that gap behind a UI that looks
persistent would be the dishonest option.

*Not built:* reassign (R5.2's third verb) needs somewhere to reassign *to*, which is R4's
proposal queue once it has run live.

### R6 — Cash position

**R6.1 — Reconciled cash into the model** — settled and confirmed balances as `LINKED`
variables (`docs/modelling-plan.md` §6).
**R6.2 — In-flight settlements** — captured but unsettled payments projected onto their T+n
credit dates. This is the forward cash forecaster, and it is now built on reconciled data
rather than on assumptions.
**R6.3 — Exceptions as a cash risk line** — unresolved value shown as a band on the
forecast. An honest forecast says how much of itself is unverified.
*Done when:* resolving an exception in R5 visibly moves the cash line in the grid.

---

## 4. Build order and the cut line

```
R0 ─► R1 ─► R2 ─► R3 ─► R4 ─► R5 ─► R6
 ✓     ✓     ✓     ✓
              stop here and you still have a submission ◄ cleared
```

**If time runs short, ship R0–R3 plus a minimal R5.** A deterministic matcher with a real
confusion matrix and an honest exception list *clears the bar*. The agent raises the
ceiling; the scoreboard is what clears the floor.

**What must not be cut:** the labelled dataset (R0.2), the false-match rate (R3.1), and the
exception list (R5.1). Those three *are* the track.

**What to cut first if needed:** R6, then R5.3, then R4.5.

---

## 5. The demo

Six minutes, in this order, and no slower:

1. **The batch.** 5,000 records, four sources, planted failures — say the number out loud.
2. **Run it.** Live. Show the throughput counter moving.
3. **The scoreboard.** Match rate, precision, false-match rate, seconds elapsed, cost.
4. **The exceptions.** Open the ugliest class — a combined credit with a chargeback — and
   show the agent's one-line evidence, then accept it in one click.
5. **The ablation.** Three bars: rules-only, hybrid, LLM-only. Explain why the middle wins.
6. **The cash line.** Resolving that exception moves the forward cash position.

Then stop. The six-agent product vision is the last slide, after the numbers — never before.

---

## 6. Risks

- **An empty exception list.** Reads as a broken evaluator, not a perfect agent. R0.3 is the
  mitigation; state the planted counts up front.
- **A full board and an empty proposal lane** — the state after R0.4. Every lane at 100%
  with nothing escalated means the *data* has no hard cases, so the agent cannot improve on
  the rules and the ablation shows three identical bars. R0.5 is the mitigation.
- **Demoing the workspace instead of the loop.** The grid is the payoff, not the pitch. A
  judge scoring this track is looking for a number.
- **LLM in the hot path.** If throughput collapses at 5,000 records, the tiering is wrong —
  T3 should see ~5% of the batch, not 50%.
- **A wrong match that ties.** The worst failure in the whole system, because it is silent.
  Track false-match rate separately and never optimise match rate against it.
- **Float money.** Integer paise everywhere. A ₹0.01 discrepancy in a reconciliation demo is
  the one bug a finance judge will catch instantly.
