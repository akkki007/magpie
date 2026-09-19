# Deploying Magpie to AWS

A step-by-step runbook for putting this app on AWS for the
[WeMakeDevs First Commit](https://www.wemakedevs.org/aws/first-commit) **Ship It** track.

Every step has a **"What this step does"** note underneath it in plain language, so you can
follow it without already knowing AWS.

Budget about **2 hours** the first time. Most of that is waiting for things to create.

---

## 1. What you are building

```
   Your browser
        |  https://
        v
   +---------------------+
   |  Application Load   |   the public front door, and the thing
   |  Balancer (ALB)     |   that lets the AI stream live
   +---------+-----------+
             | port 3000
             v
   +---------------------+        +------------------+
   |  ECS Fargate        |<-------|  Secrets Manager |  passwords + API keys
   |  (your container)   |        +------------------+
   |                     |        +------------------+
   |                     |------->|  CloudWatch Logs |  crash reports
   +---------+-----------+        +------------------+
             |                    +------------------+
             |                    |  ECR             |  where the image lives
             v                    +------------------+
   +---------------------+
   |  RDS PostgreSQL     |   the database
   +---------------------+
```

**In plain words:** your app gets packed into a box (a Docker image), the box is parked in an
AWS warehouse (ECR), AWS runs the box for you without you managing a server (Fargate), a
traffic cop sends visitors to it over HTTPS (ALB), the data lives in a managed database
(RDS), and the secrets and logs live in their own AWS services so they are never inside the
box.

### Why not the one-click option

AWS App Runner is much easier to set up, and it is on the hackathon's approved list — but it
**does not support server-sent events**
([open AWS issue](https://github.com/aws/apprunner-roadmap/issues/189)). Magpie's headline
feature is agent runs that stream token by token. On App Runner a judge would click "run
agent", see nothing for 30 seconds, then get the whole answer at once. An ALB passes streams
through untouched, so this runbook uses ECS Fargate behind an ALB.

---

## 2. Before you start — everything you need

### Accounts

| Account | Needed for | Notes |
|---|---|---|
| **AWS account** | everything | Free tier. A debit card or RuPay works; AWS charges ~₹2 to verify it. New accounts get ~$200 in credits. |
| **AWS Builder Center** | hackathon requirement | Create the profile and verify as a student. This is separate from the AWS account. |
| **OpenAI API key** | the AI agents | Already in your `.env`. |
| **Resend API key** | sign-up and magic-link emails | Optional. Leave it out and emails print to the logs instead of sending — the app still works. |
| **A domain name** | HTTPS | You already own `akkky.tech`. If you had none, Step 7 has a free alternative. |

### Tools on your laptop

| Tool | Check it works | If missing |
|---|---|---|
| **Docker Desktop** | `docker --version` | [docker.com](https://www.docker.com/products/docker-desktop/) — it must be **running**, not just installed |
| **AWS CLI v2** | `aws --version` | [AWS CLI installer](https://aws.amazon.com/cli/) |
| **Bun** | `bun --version` | [bun.sh](https://bun.sh) — needs 1.3.9 |
| **Git** | `git --version` | you already have it |
| **openssl** | `openssl version` | ships with Git for Windows |

Then connect the CLI to your account, once:

```powershell
aws configure
```

It asks for four things: your **Access Key ID** and **Secret Access Key** (create them in
Console → IAM → Users → your user → Security credentials), the **region** — type
`ap-south-1` — and the output format — type `json`.

> **What this does:** saves your AWS login on your laptop so `aws` commands stop asking who
> you are.

### Decisions made once, up front

| Thing | Value used in this guide |
|---|---|
| Region | **`ap-south-1`** (Mumbai) |
| Account ID | `111122223333` — **replace with yours** everywhere (`aws sts get-caller-identity`) |
| App name | `magpie` |
| Database name | `magpie_dev` |
| Public URL | `https://magpie-aws.akkky.tech` — **replace with yours** |

**Stay in one region.** Creating the database in Mumbai and the cluster in Virginia is the
single most common way to lose an hour, because they simply cannot see each other.

### What it costs

RDS `db.t4g.micro` is free tier. Fargate (1 vCPU / 2 GB) plus the load balancer is roughly
**$25–35 per month**, which your $200 in credits covers comfortably. Step 12 says what to
delete afterwards so it stops charging.

### Files this runbook depends on

Both are already in the repo:

- `Dockerfile` — the recipe for packing the app into a box
- `.dockerignore` — the list of files to leave out of the box

---

## Step 1 — Create the AWS account and verify as a student

1. Sign up at [aws.amazon.com](https://aws.amazon.com/) and finish card verification.
2. Set the region switcher in the top-right of the console to **Asia Pacific (Mumbai)
   ap-south-1**.
3. Create your **AWS Builder Center** profile and complete student verification.

> **What this step does:** gets you an account with free credits, points the whole console at
> one region so nothing ends up scattered, and ticks the hackathon's Builder Center
> requirement. Do the Builder Center part now — it is a rule, not a bonus, and it is easy to
> forget until the deadline.

---

## Step 2 — Create the database (RDS PostgreSQL)

Console → **RDS** → **Create database**:

| Field | Value |
|---|---|
| Creation method | Standard create |
| Engine | **PostgreSQL** |
| Template | **Free tier** |
| DB instance identifier | `magpie-db` |
| Master username | `magpie` |
| Credentials management | **Self managed** → let it auto-generate the password |
| Instance class | `db.t4g.micro` |
| Storage | 20 GB, gp3 |
| **Public access** | **Yes** |
| VPC security group | **Create new** → name it `magpie-db-sg` |
| Additional configuration → **Initial database name** | **`magpie_dev`** |

Click create, then **copy the generated password immediately** — AWS shows it once, in a
green banner, and never again.

It takes about 5 minutes. When it says **Available**, copy the **Endpoint** from the
Connectivity tab. Your connection string is:

```
postgresql://magpie:YOUR_PASSWORD@magpie-db.xxxxx.ap-south-1.rds.amazonaws.com:5432/magpie_dev?sslmode=require
```

Then open the firewall for yourself: RDS → `magpie-db` → Connectivity & security → click
`magpie-db-sg` → **Inbound rules** → **Edit** → **Add rule**:

- Type **PostgreSQL**, Port **5432**, Source **My IP**

> **What this step does:** creates the PostgreSQL server your app stores everything in, and
> opens a door in its firewall so *only your laptop* can reach it for now.
>
> Two fields matter more than they look:
>
> - **Public access: Yes** — without it you cannot run migrations from your laptop in Step 3,
>   and you would have to do it the hard way from inside AWS.
> - **Initial database name: `magpie_dev`** — leave it blank and RDS gives you a running
>   *server* with **no database inside it**. Your app then fails with a confusing "database
>   does not exist" error that looks nothing like a missing checkbox.

---

## Step 3 — Put your schema and demo data into the database

In PowerShell, from the project folder:

```powershell
bun install

$env:DATABASE_URL="postgresql://magpie:YOUR_PASSWORD@magpie-db.xxxxx.ap-south-1.rds.amazonaws.com:5432/magpie_dev?sslmode=require"
$env:DIRECT_URL=$env:DATABASE_URL

bunx prisma migrate deploy
bun run db:generate

bun run seed
bun run seed:database
bun run seed:board
```

If you get an SSL certificate error, change `?sslmode=require` to `?sslmode=no-verify` and run
it again.

> **What this step does:** `migrate deploy` creates all the tables — users, sessions, the
> modelling grid, boards, agent runs — by replaying the migration files in
> `prisma/migrations` against the empty AWS database. The three `seed` commands then fill it
> with the demo content: the finance model, the Customers table, and the reporting board.
>
> **Do this before deploying the app.** An app pointed at an empty database is not obviously
> broken — it just shows blank screens, and you will waste an hour hunting a bug that is
> really just missing data.

---

## Step 4 — Store the secrets

Console → **Secrets Manager** → **Store a new secret**. Choose **Other type of secret** →
**Plaintext** tab → delete the `{}` it pre-fills → paste your value → Next → give it the name
below → Next → Next → Store.

Repeat four times:

| Secret name | Value to paste |
|---|---|
| `magpie/DATABASE_URL` | the full connection string from Step 2 |
| `magpie/BETTER_AUTH_SECRET` | the output of `openssl rand -base64 32` |
| `magpie/OPENAI_API_KEY` | your OpenAI key (`sk-...`) |
| `magpie/RESEND_API_KEY` | your Resend key — skip this one if you are not sending real email |

> **What this step does:** puts your passwords and API keys in a vault that AWS injects into
> the running container at start-up.
>
> **Why not just type them as environment variables?** Because anyone with read access to
> your task definition can see plain environment variables, and they show up in exported
> config and in screenshots. Secrets Manager keeps them out of all of that — and you are
> about to screen-record this console for a demo video.
>
> Use the **Plaintext** type, not key/value. Key/value secrets need a longer, fiddlier
> reference format in Step 6.

---

## Step 5 — Pack the app into an image and upload it

Make sure **Docker Desktop is running**, then:

```powershell
# 1. Confirm your account ID
aws sts get-caller-identity

# 2. Create the warehouse shelf for your image
aws ecr create-repository --repository-name magpie --region ap-south-1

# 3. Log Docker in to it
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 111122223333.dkr.ecr.ap-south-1.amazonaws.com

# 4. Build the image (5-10 minutes the first time)
docker build -t magpie .

# 5. Label it and push it
docker tag magpie:latest 111122223333.dkr.ecr.ap-south-1.amazonaws.com/magpie:latest
docker push 111122223333.dkr.ecr.ap-south-1.amazonaws.com/magpie:latest
```

> **What this step does:** `docker build` reads the `Dockerfile` and produces a single
> self-contained box holding Node, your dependencies, and the compiled Next.js app.
> `ecr create-repository` makes a private shelf in AWS to keep it on, and `push` uploads it.
> Fargate pulls it from that shelf in Step 6.
>
> **Do this step early.** It is the step most likely to fail, and finding out at 11pm is much
> worse than finding out now. If the build errors, the message names the file — fix it and
> run `docker build` again; unchanged layers are cached, so the retry is fast.
>
> One detail from the `Dockerfile` worth knowing: it sets a **fake** `DATABASE_URL` during the
> build. `lib/db.ts` throws the moment it is loaded if that variable is missing, and Next.js
> loads every route while compiling — so the build needs a valid-looking URL even though it
> never connects to anything. Baking the real one in would put your database password inside
> the image forever.

---

## Step 6 — Run the container on ECS Fargate

### 6a. Create the cluster

ECS → **Clusters** → **Create cluster** → name `magpie` → Infrastructure: **AWS Fargate
(serverless)** → Create.

> **What this does:** creates the empty "place" your containers will run in. Nothing is
> running yet and nothing is charged yet.

### 6b. Create the task definition

ECS → **Task definitions** → **Create new task definition**:

| Field | Value |
|---|---|
| Family | `magpie` |
| Launch type | **AWS Fargate** |
| CPU / Memory | **1 vCPU**, **2 GB** |
| Task role | leave as is |
| Task execution role | **Create new role** (it will be named `ecsTaskExecutionRole`) |

Container:

| Field | Value |
|---|---|
| Name | `web` |
| Image URI | `111122223333.dkr.ecr.ap-south-1.amazonaws.com/magpie:latest` |
| Container port | **3000** |

**Environment variables** (plain, not secret):

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `OPENAI_MODEL` | `gpt-5.6` |
| `MAIL_FROM` | `Magpie <hello@magpie.akkky.tech>` |
| `BETTER_AUTH_URL` | `http://placeholder` — you fix this in Step 8 |

**Environment variables from Secrets Manager** — for each, choose **ValueFrom** and paste the
secret's ARN (copy it from the Secrets Manager page):

`DATABASE_URL` · `BETTER_AUTH_SECRET` · `OPENAI_API_KEY` · `RESEND_API_KEY`

Leave **Use log collection / CloudWatch** switched **on**. Create.

> **What this does:** writes the recipe card for a running copy of your app — which image,
> how much CPU and memory, which port, and which settings to hand it. Creating it starts
> nothing; it is just the instructions.
>
> `BETTER_AUTH_URL` is a placeholder because the real URL does not exist yet — the load
> balancer is created in the next step and its address is generated at that moment. This is a
> genuine chicken-and-egg, which is why Step 8 exists.
>
> Leave CloudWatch logging on. When a container dies on start-up it leaves no trace anywhere
> else, and the log stream is the only place the stack trace appears.

### 6c. Create the service and the load balancer

Open your `magpie` cluster → **Services** tab → **Create**:

| Field | Value |
|---|---|
| Compute | Launch type → **FARGATE** |
| Task definition family | `magpie`, revision: latest |
| Service name | `magpie-svc` |
| Desired tasks | **1** |

Networking:

| Field | Value |
|---|---|
| VPC | the default one |
| Subnets | the **public** subnets |
| Security group | **Create new** → `magpie-app-sg` |
| **Public IP** | **Turned on** |

Load balancing:

| Field | Value |
|---|---|
| Type | **Application Load Balancer** |
| Name | `magpie-alb` |
| Listener | **Create new**, port **80**, HTTP |
| Target group | **Create new**, `magpie-tg`, port **3000** |
| Health check path | `/` |
| Health check success codes | **`200-399`** |

Create, then wait 3–5 minutes for the task to show **Running** and the target group to show
**healthy**.

> **What this does:** actually starts your app, and puts a public address in front of it.
>
> Three settings that break things when they are wrong:
>
> - **Public IP: Turned on** — a Fargate task with no public IP and no NAT gateway cannot
>   reach ECR to download your image. It fails with a timeout that reads like a permissions
>   problem but is really a networking one.
> - **Health check path `/`** — the load balancer pings this every 30 seconds to decide
>   whether your app is alive. If it fails, the ALB kills the task and starts another, over
>   and over.
> - **Success codes `200-399`** — the default is `200` only. Magpie's `/` redirects a
>   signed-in visitor to `/workspace` (see `proxy.ts`), which is a `307`. With the default, a
>   perfectly healthy app gets declared dead. A redirect is not a failure.

### 6d. Let the app talk to the database

RDS → `magpie-db` → Connectivity & security → click `magpie-db-sg` → **Inbound rules** →
**Edit** → **Add rule**:

- Type **PostgreSQL**, Port **5432**, Source **Custom** → start typing `magpie-app-sg` and
  pick it

> **What this does:** right now the database only accepts your laptop. This opens a second
> door, just for the container. You are naming a security group rather than an IP address
> because Fargate tasks get a new IP every time they restart — the group stays the same
> whatever address the task lands on.

---

## Step 7 — Turn on HTTPS

**This is not optional.** `lib/auth.ts` sets `useSecureCookies` on in production, and browsers
refuse to send secure cookies over plain `http://`. Over HTTP, sign-up appears to succeed and
then silently logs you straight back out.

1. **ACM** (make sure you are in `ap-south-1`) → **Request a certificate** → Public → domain
   name `magpie-aws.akkky.tech` → **DNS validation** → Request.
2. Open the certificate, copy the **CNAME name and value** it shows, and add that CNAME record
   in your domain's DNS. The status turns **Issued** within a few minutes.
3. EC2 → **Load Balancers** → `magpie-alb` → **Listeners** tab → **Add listener**:
   - Protocol **HTTPS**, port **443**
   - Default action: **Forward to** `magpie-tg`
   - Certificate: the one you just issued
4. In your DNS, add a **CNAME**: `magpie-aws` → the ALB's DNS name (from the load balancer's
   Description tab).
5. Optional but tidy: edit the port-80 listener and change its action to **Redirect to
   HTTPS**.

> **What this does:** gives your app a real `https://` address with a trusted certificate. ACM
> issues the certificate for free; the DNS record is how you prove to AWS that you own the
> domain; the HTTPS listener is what actually terminates the encryption at the load balancer.
>
> **If you do not have a domain:** put a **CloudFront** distribution in front of the ALB
> instead. Set the ALB as the origin, cache policy **CachingDisabled**, origin request policy
> **AllViewer**. You get a free `https://xxxx.cloudfront.net` address. Those two policy
> settings are not optional — the defaults strip cookies and buffer responses, which breaks
> both sign-in and the live agent streaming.

---

## Step 8 — Point the app at its real URL and redeploy

1. ECS → Task definitions → `magpie` → **Create new revision**
2. Change `BETTER_AUTH_URL` from `http://placeholder` to `https://magpie-aws.akkky.tech`
3. Create
4. ECS → cluster `magpie` → `magpie-svc` → **Update service** → pick the new revision → tick
   **Force new deployment** → Update

> **What this does:** Better Auth builds its sign-in links, its email verification links, and
> its cookie settings from `BETTER_AUTH_URL`. If it is wrong, magic links point at a dead
> address and sessions do not stick.
>
> Task definitions are versioned and **cannot be edited in place** — every change creates a
> new numbered revision, and the service keeps running the old one until you explicitly tell
> it to switch. That is what "Force new deployment" does. It takes 2–3 minutes and there is no
> downtime: AWS starts the new container, waits for it to be healthy, then stops the old one.

---

## Step 9 — Check it actually works

Open `https://magpie-aws.akkky.tech` and walk through:

- [ ] Landing page loads
- [ ] Sign up at `/sign-up` → lands on `/workspace`
- [ ] **Refresh the page — you are still signed in** ← this is the HTTPS/cookie check
- [ ] `/workspace` shows the seeded model grid, and an edited cell survives a reload
- [ ] `/recon` shows the review queue with real numbers
- [ ] **Run an agent and watch it stream in word by word** ← this is the load-balancer check
- [ ] Open it on your phone

If something 500s: ECS → cluster → **Tasks** → click the task → **Logs** tab. That is
CloudWatch, and the stack trace is there.

> **What this step does:** proves the two decisions that shaped this whole runbook. Staying
> signed in after a refresh proves HTTPS and the secure cookies are right. The agent streaming
> word by word proves the load balancer is passing the stream through instead of holding on to
> it — the thing App Runner would have got wrong.

---

## Step 10 — Troubleshooting

| What you see | What it actually is | Fix |
|---|---|---|
| Task stuck in `PROVISIONING`, then stops | Cannot reach ECR to pull the image | Turn **Public IP** on in the service's network config |
| `ResourceInitializationError ... secretsmanager` | The execution role cannot read your secrets | IAM → `ecsTaskExecutionRole` → attach `SecretsManagerReadWrite` |
| Target group stuck **unhealthy**, task keeps restarting | The health check is failing | Success codes must be `200-399`, path `/`, target port `3000` |
| App loads, sign-in "works" then logs you out | Secure cookies over plain HTTP | Finish Step 7, and set `BETTER_AUTH_URL` to the `https://` address |
| `P1001: Can't reach database server` | Security group, or wrong region | RDS inbound must allow `magpie-app-sg`; both must be in `ap-south-1` |
| SSL / self-signed certificate error from Prisma | RDS certificate is not in the trust store | Change `?sslmode=require` to `?sslmode=no-verify` |
| Pages load but every screen is empty | The database has tables but no data | Re-run the three `seed` commands from Step 3 |
| `docker build` fails on `next build` | A real build error | Read the filename in the error, fix it, rebuild — it is cached, so it is quick |

---

## Step 11 — Say these AWS services out loud in the demo video

Judges score **AWS Integration** from what they can see and hear. Spend 20 seconds on the
diagram at the top of this file and name these:

| Service | What it does here |
|---|---|
| **ECS + Fargate** | runs the container, with no servers to manage |
| **ECR** | private registry holding the image |
| **Application Load Balancer** | public HTTPS entry point; passes the agent stream through live |
| **RDS PostgreSQL** | the database behind the model, the boards and auth |
| **Secrets Manager** | database URL, auth secret and API keys, never inside the image |
| **CloudWatch Logs** | application logs and crash traces |
| **ACM** | the TLS certificate |
| **IAM** | the task execution role |

**The biggest remaining score win:** the AI is still entirely non-AWS. Swapping
`lib/agents/finance-ops.ts` from `ChatOpenAI` to `ChatBedrockConverse` (`@langchain/aws`) puts
**Amazon Bedrock** in that table and turns the AI story into an AWS story. It is roughly a
one-line change plus an IAM policy on the task role.

---

## Step 12 — Shut it down after judging

Delete in this order, or the dependencies block each other:

1. ECS → `magpie-svc` → **Delete service**
2. EC2 → Load Balancers → `magpie-alb` → **Delete**
3. EC2 → Target Groups → `magpie-tg` → **Delete**
4. RDS → `magpie-db` → **Delete** (skip the final snapshot)
5. ECR → `magpie` repository → **Delete**

> **What this does:** stops the meter. The load balancer and Fargate charge by the hour
> whether or not anyone visits, and they will keep quietly draining your credits for months if
> you forget. Set a **Billing → Budgets** alert at $20 as a safety net.
