# Magpie — the whole project, in plain language

> A single document for the team. Read it top to bottom once, and you can explain
> Magpie to anyone: a judge, a recruiter, a friend who has never opened a spreadsheet.
>
> Part 7 splits the pitch video into **4 parts, one per team member.**

---

## 1. Why we built this

Every company runs on a spreadsheet that one person understands.

That sounds like a joke, but it is literally how planning works at most startups and
mid-size companies. There is one giant Excel or Google Sheet — the "model" — that answers
the questions the business actually cares about:

- How much cash do we have left, and for how many months?
- If we hire 10 more people, when do we run out?
- Did we actually collect the money our reports say we earned?

That file is fragile. A formula points at cell `H47`. Someone inserts a row. `H47` is now
a different number, and nobody notices for three weeks. There is no history, no undo you
can trust, no way to ask "who changed this and why". At quarter end, the finance team
spends more time *repairing* the spreadsheet than *thinking about the plan*.

We built Magpie because that job — the repairing — should not be a human job any more.

**Our one-line reason:** *finance teams should spend their time shaping the plan, not
fixing the file the plan lives in.*

---

## 2. What Magpie actually is

**Magpie is an AI-native finance workspace.** One place where a company's real data,
its forecast, and AI agents that can work on both live together.

Think of it as three things fused into one product:

| Think of it as | What it replaces |
|---|---|
| A modelling tool | the company's planning spreadsheet |
| A data workspace | the exports, CSVs and manual copy-paste between systems |
| An AI analyst inside both | the junior analyst who spends two days making a chart |

### What you can actually do in it today

Everything below is **built and running**, not a mockup:

**1. Model the business — with variables, not cells.**
`/workspace` is the modelling grid. Each row is a *named variable* ("Enterprise ARR",
"Churn %"), and it carries its own formula, its own unit, its own trend line, its own
history. Formulas reference **names, not coordinates** — so `Revenue - Costs` keeps working
no matter how many rows anyone inserts. The `H47` bug simply cannot happen here.

You can switch grain (month / quarter / year) and rollups stay correct by construction,
because every variable knows how it is allowed to aggregate — a currency sums, a percentage
does not.

**2. Run scenarios.**
Duplicate the plan, change three assumptions, and diff it against the base case. What-ifs
sit side by side instead of in `model_v4_FINAL_final.xlsx`.

**3. Keep real data next to the plan.**
`/databases` holds actual records — customers, deals, invoices — as proper typed tables,
not as pasted values. `/boards` turns those into charts and KPI tiles. So the forecast and
the reality it is supposed to predict live in the same product.

**4. Let AI agents do the analyst work.**
`/agents` runs a real multi-agent system. You ask something like *"why did gross margin
slip in Q3, and what should we do?"* and the agent:

- writes a **to-do plan first**, visible to you, so you can see where the run has reached;
- delegates to **subagents** — a `model-analyst` that reads the forecast, a `data-analyst`
  that reads the database;
- streams its reasoning back **token by token**, live;
- and ends with a **proposal, not a write**.

That last point is the most important design decision in the whole project. **The agent
cannot change your numbers.** The graph physically halts before any write tool runs and
waits for a human to approve. Safety here is a *state the run cannot escape*, not a
politely-worded prompt.

**5. Reconciliation — the part with hard numbers.**
`/recon` solves a specific, painful, real accounting job (explained fully in Part 3).
Against an 11,258-record test batch with a known answer key:

| Metric | Result |
|---|---|
| Precision | **100%** |
| False matches | **0** |
| Auto-match rate | **98.6%** |
| Left for a human | 1.4% — six links, deliberately |

**6. Undo and audit are the same mechanism.**
Every change — typed by a human or proposed by an agent — is a **command that carries its
own inverse**. So the undo button and the audit log are not two features; they are one
thing looked at from two sides. You can always answer "who changed this, when, and what
was it before".

---

## 3. The real-world problem we solved

We deliberately picked a problem that is boring, expensive, and completely real.

### The problem: payment reconciliation

A company sells online. Money arrives from a payment gateway. There are now **four
different records of the same money**, and none of them agree:

1. **Payments** — what the gateway says the customer paid.
2. **Settlements** — what the gateway actually deposited, after fees, batched together.
3. **Bank credits** — what the bank statement shows landing in the account.
4. **The ledger** — what the accounting system thinks happened.

They never line up cleanly. The gateway bundles 200 payments into one deposit. Fees are
deducted mid-flight. A refund reverses a payment three days later. A chargeback claws money
back a month later. A bank reference number is truncated. A row is duplicated.

So somebody — usually an accountant, usually at month end, usually until midnight — sits
with two exports open and matches them **by hand**. At scale this is thousands of rows a
month. It is slow, it is error-prone, and an error here is not cosmetic: **the company's
reported cash position is wrong.**

### Why this is not just "throw an LLM at it"

This is the part we are proudest of, and it is the strongest thing to say to a judge.

An LLM asked to compare five thousand pairs of amounts will be right *almost* always.
**"Almost always" is the worst possible property for a system whose job is deciding whether
two numbers are equal.** A silent wrong match corrupts the books and nobody finds out.

So Magpie does it the other way around:

- A **deterministic matcher** does the money maths. Reference + amount + date window +
  fee tolerance + subset-sum search for batched deposits. No model anywhere in that file.
  Every decision is one you can step through and debug.
- It works in **escalating tiers** — the easy 70% is resolved first, so the expensive
  structural search only ever runs on what is left.
- When the rules are not sure, the matcher **abstains**. It raises an exception into a
  human review queue instead of guessing.
- Only *then*, on the residue, does an **LLM adjudication tier** get involved — and its
  output is a suggestion behind a validation gate, never a silent write.

And we built the **scoreboard before the matcher**, against an answer key the matcher has
never seen — because tuning a system without a scoreboard is just guessing with extra
steps.

**The result:** the accountant's midnight job shrinks from thousands of rows to six. And
resolving those six visibly shrinks the "unverified" band on the company's forward cash
position, on screen.

**That is the problem we solved:** *we gave the machine the part it is exact at, and gave
the human only the part that actually needs judgement.*

---

## 4. How it works — the build, in plain words

### The stack

TypeScript · **Next.js 16** (App Router) · React 19 · Tailwind v4 · **Prisma 7 on
PostgreSQL** · Better Auth · Bun · **LangGraph deep agents** · CopilotKit / AG-UI for
generative UI · OpenAI · Resend for mail.

No component library, no chart library. `components/ui` owns its own primitives and every
chart is hand-drawn SVG — because every dependency added is one more thing that has to
agree with the design.

### The four layers

```
  +---------------------------------------------------------+
  |  UI          the grid, the boards, the agent panel       |
  |              streaming, generative, hand-built           |
  +---------------------------------------------------------+
  |  Agents      LangGraph deep agents: a supervisor that    |
  |              plans, subagents that read, an approval     |
  |              gate the run cannot skip                    |
  +---------------------------------------------------------+
  |  Engine      AST formulas - cell-level evaluation -      |
  |              aggregation rollup - a command bus where    |
  |              every command carries its inverse           |
  +---------------------------------------------------------+
  |  Data        PostgreSQL via Prisma - the model, the      |
  |              tables, the recon records, the sessions     |
  +---------------------------------------------------------+
```

### How you would build this yourself (the honest order)

1. **Auth and tenancy first.** Sessions as database rows, not JWTs, so a session can be
   revoked. Everything else hangs off this boundary.
2. **The engine before the UI.** Parse formulas into an AST, evaluate per cell, roll up by
   unit rules. `bun run calc:check` asserts the rollup is right.
3. **Commands, not mutations.** Never let anything write to the model directly. Every
   change goes through a typed command that knows how to undo itself. Undo, audit and
   agent proposals all fall out of this one decision for free.
4. **The scoreboard before the agent.** For recon: generate labelled synthetic data, write
   the scorer, *then* write the matcher. `bun run recon:eval` prints the truth.
5. **The agent last, and boxed in.** Give it read tools freely. Put every write behind a
   human. Stream everything so the user can watch it think.

### The checks we can run live

```bash
bun run calc:check     # the modelling engine's rollup is correct
bun run recon:eval     # precision, recall, false-match rate against the answer key
bun run data:check     # the database layer
bun run board:check    # the reporting boards
bun run typecheck      # the whole thing compiles
```

---

## 5. How we used AWS

Magpie is deployed on AWS in **`ap-south-1` (Mumbai)**. This is the architecture:

```
        Your browser
             |  https://
             v
   +--------------------+
   |  CloudFront + ACM  |   HTTPS, and the reason cookies work
   +---------+----------+
             v
   +--------------------+
   |  Application Load  |   the public front door - and the thing
   |   Balancer (ALB)   |   that lets the AI stream live
   +---------+----------+
             | port 3000
             v
   +--------------------+      +------------------+
   |   ECS Fargate      |<-----|  Secrets Manager |  DB password, API keys
   |  (the container)   |      +------------------+
   |  1 vCPU / 2 GB     |      +------------------+
   |                    |----->|  CloudWatch Logs |  every crash, every request
   +---------+----------+      +------------------+
             |                 +------------------+
             |                 |       ECR        |  where the image lives
             v                 +------------------+
   +--------------------+
   |  RDS PostgreSQL    |   the model, the data, the sessions
   +--------------------+
```

### Service by service — what each one is for

| AWS service | What it does for Magpie | Why this one |
|---|---|---|
| **ECR** | Stores the Docker image of the app | The app is packed into one box; ECR is the warehouse |
| **ECS Fargate** | Runs that box, 1 vCPU / 2 GB | Serverless containers — no EC2 instance to patch, SSH into, or forget about |
| **ALB** | Public front door, health checks, routing to port 3000 | **It passes server-sent events through untouched** — see below |
| **RDS PostgreSQL** | The database: model, tables, recon records, sessions | Managed backups and failover; `db.t4g.micro` is free tier |
| **Secrets Manager** | DB password, `OPENAI_API_KEY`, auth secret | Secrets are injected at runtime — **never in a commit, never baked into an image layer**. Our Dockerfile deliberately bakes a *fake* `DATABASE_URL` |
| **CloudWatch Logs** | Every log line from the container | When a page 500s in the demo, we read the actual stack trace instead of guessing |
| **CloudFront + ACM** | HTTPS in front of the ALB | Secure cookies are on in production — over plain HTTP sign-in silently fails |
| **IAM** | Least-privilege roles; the execution role reads only the secret ARNs it needs | The blast radius of a leaked role stays small |
| **VPC / Security Groups** | Only the app's security group can reach Postgres on 5432 | The database is not reachable from anywhere else on the app's path |

### The one AWS decision worth saying out loud in the pitch

**We deliberately did not use AWS App Runner, even though it was on the approved list and
would have taken 10 minutes instead of 2 hours.**

App Runner does not support server-sent events. Magpie's headline feature is agent runs
that stream token by token. On App Runner a judge would click "run agent", stare at a blank
panel for 30 seconds, and then get the entire answer at once — the product would look
broken. An ALB passes the stream through untouched.

*We chose the harder deployment because the easier one would have silently broken the
feature we are demoing.* That is an architecture decision driven by the product, and it is
exactly the kind of thing judges give marks for.

### Cost

RDS `db.t4g.micro` is free tier. Fargate plus the load balancer is roughly **$25–35 per
month** — comfortably inside the ~$200 of new-account credits. We documented the teardown
too, because resources you forget about drain credits quietly for months.

### The deployment is documented, not improvised

`DEPLOY.md` is a full runbook where **every step says what it does and why**, in plain
language, so someone who has never opened the AWS console can follow it. It includes the
failure table — the errors that *look like a bug in the app and are not*:

| Symptom | Real cause |
|---|---|
| Signs in, then instantly logged out | Secure cookie over HTTP — finish the HTTPS step |
| `ResourceInitializationError … secretsmanager` | Execution role cannot read the secrets |
| Every page is empty but nothing errors | Database has tables but no data |
| `self-signed certificate` from the app | RDS CA not trusted — needs `sslmode=no-verify` |

---

## 6. The pitch — problem to conclusion

This is the narrative spine. Everything in Part 7 is just this, split four ways.

### The shape

**Hook → Problem → Why it is still unsolved → Our answer → Proof → How it is built →
Conclusion → Ask**

### The beats, with words you can actually say

**1. The hook (15s)**

> "Every company runs on a spreadsheet that exactly one person understands. And every
> quarter, that person spends more time fixing the file than thinking about the plan."

**2. The problem (45s)**

> "Two problems, really. The forecast lives in a fragile file where a formula points at
> cell H47 — insert a row, and H47 is now a different number. And the data that forecast
> depends on is wrong anyway, because nobody has finished reconciling it. Money leaves the
> customer, the gateway batches it, the bank posts it, the ledger records it — four records
> of the same rupee, and they never agree. So an accountant matches them by hand. Thousands
> of rows. At midnight. At month end."

**3. Why it is still unsolved (20s)**

> "And you can't just throw an LLM at it. A model comparing five thousand amounts will be
> right *almost* always — which is the worst possible property for a system deciding whether
> two numbers are equal. One silent wrong match and the books are wrong, and nobody knows."

**4. Our answer — Magpie (45s)**

> "Magpie is an AI-native finance workspace. Three things in one place: a model built from
> named variables instead of cell coordinates, the real data that model depends on, and AI
> agents that can work across both. Every change — human or AI — is a command that carries
> its own inverse, so undo and the audit trail are the same mechanism. And the agent can
> never write to your numbers. The run physically halts and waits for a human."

**5. The proof — demo (75s)**

> Show, don't claim. Edit a cell, reload, it persisted. Ask the agent a real question, let
> the to-do list build itself and the answer stream in. Then `/recon`: *"11,258 records.
> 100% precision. Zero false matches. 98.6% auto-matched. Six exceptions left for a human —
> and clearing one shrinks the unverified band on the cash position, live."*

**6. How it is built (40s)**

> "Next.js 16, Postgres, LangGraph deep agents — deployed on AWS: Fargate behind an ALB,
> RDS, secrets in Secrets Manager, logs in CloudWatch. We skipped App Runner on purpose —
> it doesn't support server-sent events, and our agent streams token by token. The easy
> deploy would have silently broken the feature we are demoing."

**7. The conclusion (20s)**

> "The machine does the part it is exact at. The human does the part that actually needs
> judgement. That is the whole idea — and it's the reason the accountant's thousand-row
> night becomes six decisions."

**8. The ask (10s)**

> "It's live, it's open source, and the runbook to deploy it on AWS is in the repo. Try it."

### Rules for the video

- **Show the product on screen for at least half the runtime.** The demo *is* the argument.
- **Say one number per section, not five.** "98.6%" lands. A table does not.
- **Never say "we were going to build".** Say what is built. Being honest about what is
  roadmap (organisation roles, live ERP connectors, the 100-metric library) makes
  everything else more believable.
- **Let the agent stream on camera.** Don't cut it. The live token stream is the proof that
  the AWS architecture decision was right.
- **End on the human, not the tech.** The accountant who goes home at 7.

---

## 7. The four parts — who presents what

Split the video into four segments. Each member owns one, and each owns the matching part
of the repo, so anything asked in Q&A is answerable by the person who spoke.

---

### PART 1 — The Problem & The Why

**Runtime: ~60–70 seconds · Opens the video**

**You are the storyteller. No code on screen yet — you are making the audience *feel* the
pain before anyone sees a product.**

Cover:

- The hook: the one spreadsheet one person understands.
- The `H47` fragility — a formula pointing at a coordinate, and someone inserts a row.
- The reconciliation problem: four records of the same rupee that never agree.
- The human cost: a person matching thousands of rows by hand, at midnight, at month end.
- Why an LLM alone is the wrong answer: "right almost always" is a disqualifying property
  when the job is deciding if two numbers are equal.
- Land the thesis: **"the machine should do the exact part, the human should do the
  judgement part."**

Own in the repo: `README.md`, the landing page (`app/(marketing)`), the problem framing.

Prepare for: *"Who is your user?"* · *"How big is this market?"* ·
*"Why hasn't Excel solved this?"*

---

### PART 2 — The Product Demo

**Runtime: ~90 seconds · The heart of the video**

**You are driving the product live. This is the most important segment — more than half the
video's persuasion happens here.**

Show, in this order:

1. `/workspace` — the modelling grid. Point at a row: *"this is a named variable, not cell
   H47."* Edit a cell. **Reload the page. It persisted.**
2. Switch grain month → quarter. Say why the rollup is right by construction: each variable
   knows how it aggregates.
3. A scenario, diffed against the base case.
4. `/databases` and `/boards` — the real data and the charts sitting beside the forecast.
5. Undo a change. Say the line: **"undo and the audit log are the same mechanism, because
   every command carries its own inverse."**

Own in the repo: `app/(app)/workspace`, `app/(app)/models`, `app/(app)/databases`,
`app/(app)/boards`, `lib/model`, `lib/data`, `lib/board`.

Prepare for: *"What happens if two people edit at once?"* · *"Can I import my existing
spreadsheet?"* (yes — CSV ingestion across seven sources, and every unparseable row is
recorded as a typed rejection rather than silently dropped).

**Rehearse this segment five times.** A fumbled click here costs more than a weak sentence
anywhere else.

---

### PART 3 — The AI & The Numbers

**Runtime: ~90 seconds · The credibility segment**

**You are proving the AI is real and that it is safe. This is where the hard numbers land.**

Show:

1. `/agents` — ask a real question: *"why did gross margin slip in Q3, and what should we
   do?"*
2. **Let the to-do list write itself on camera.** Say: *"that list is the progress bar — a
   multi-step investigation behind a spinner is indistinguishable from a hung one."*
3. Point out the subagents: `model-analyst` reads the plan, `data-analyst` reads the
   database. Say why: **context isolation** — delegation here is about whose context holds
   what, not an org chart.
4. **Let it stream.** Do not cut.
5. The proposal appears as ghost values beside the live ones. Say the hard line: **"the
   agent cannot write. The graph halts before the write tool runs and waits for a human.
   That's a state the run can't escape, not a convention a future tool can forget."**
6. Then `/recon`. Deliver the numbers:
   > **11,258 records. 100% precision. Zero false matches. 98.6% auto-matched.
   > Six exceptions left for a human.**
7. Explain the tiering in one breath: deterministic rules do the money maths, they abstain
   when unsure, and the LLM only ever sees the residue — behind a validation gate.
8. Resolve one exception on camera and show the unverified band shrink.

Own in the repo: `lib/agents`, `lib/recon`, `app/(app)/agents`, `app/(app)/recon`,
`bun run recon:eval`, `bun run calc:check`.

Prepare for: *"How do you know it's 100% precise?"* (we built the scoreboard before the
matcher, against an answer key the matcher has never seen) · *"Which model?"* ·
*"What does a run cost?"* · *"Why not just let the AI do the matching?"*

---

### PART 4 — AWS Architecture, Conclusion & The Ask

**Runtime: ~70–80 seconds · Closes the video**

**You are the engineer. Show the diagram, justify one hard decision, then land the plane.**

Cover:

1. Put the architecture diagram on screen. Walk it in one pass:
   **browser → CloudFront (HTTPS) → ALB → ECS Fargate → RDS Postgres**, with
   **Secrets Manager** feeding it credentials, **CloudWatch** taking the logs, and **ECR**
   holding the image. Region: **ap-south-1, Mumbai**.
2. **Deliver the decision.** This is your strongest 20 seconds:
   > "App Runner was on the approved list and would have taken ten minutes. We didn't use
   > it. App Runner doesn't support server-sent events — our agent streams token by token,
   > so on App Runner a judge would click *run*, see nothing for thirty seconds, then get
   > the whole answer at once. The product would look broken. An ALB passes the stream
   > through untouched. We took the two-hour deploy so the feature you just watched would
   > actually work."
3. Security posture in one line: **secrets are injected at runtime from Secrets Manager and
   never live in a commit or an image layer** — the Dockerfile deliberately bakes a *fake*
   database URL. Security groups mean only the app's group can reach Postgres.
4. Cost honesty: RDS on free tier, ~$25–35/month for Fargate plus the ALB, and we
   documented the teardown too.
5. Say that `DEPLOY.md` explains **every step and why**, including the failure table — the
   errors that look like app bugs and are not.
6. **The conclusion:** *"The machine does the part it's exact at. The human does the part
   that needs judgement."*
7. **The ask:** live, open source, runbook in the repo. Invite them to deploy it.

Own in the repo: `Dockerfile`, `DEPLOY.md`, `next.config.ts`, and the AWS console.

Prepare for: *"How does it scale?"* · *"What's your cold start?"* ·
*"What if the AI provider goes down?"* · *"Is the database backed up?"*

---

### Timing at a glance

| Part | Owner | Topic | Time |
|---|---|---|---|
| 1 | Member A | Problem & Why | ~65s |
| 2 | Member B | Product demo | ~90s |
| 3 | Member C | AI & the numbers | ~90s |
| 4 | Member D | AWS, conclusion, ask | ~75s |
| | | **Total** | **≈ 5:20** |

Cut to ~4:00 if there is a hard limit: trim Part 1 to the hook plus the recon problem, and
trim Part 2 to the grid edit + reload and the undo line. **Never trim Part 3's numbers or
Part 4's App Runner decision** — those two are the reasons a judge remembers you.

---

## 8. One-paragraph version (for a form field, or an elevator)

> Magpie is an AI-native finance workspace. Instead of a fragile spreadsheet where formulas
> point at cell coordinates, the model is built from named variables that carry their own
> formula, unit and history — and every change, whether a human types it or an agent
> proposes it, is a command that carries its own inverse, so undo and the audit trail are
> one mechanism. AI agents plan visibly, delegate to subagents, stream live, and physically
> cannot write to your numbers without a human approving. Our reconciliation engine matches
> payments, settlements, bank credits and ledger entries with deterministic rules that
> abstain when unsure: on an 11,258-record batch it hit 100% precision with zero false
> matches and 98.6% auto-matched, leaving six exceptions for a human. It runs on AWS — ECS
> Fargate behind an ALB, RDS Postgres, secrets in Secrets Manager, logs in CloudWatch — and
> we chose the ALB over the simpler App Runner because App Runner cannot stream.

---

*All the best. Go win it.*
