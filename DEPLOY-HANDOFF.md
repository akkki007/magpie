# Magpie AWS deploy — handoff (resume at Step 5)

> **Read this first, Claude Code.** You are on a *second* laptop. Steps 1–4 of `DEPLOY.md`
> were done on the first laptop. The image push (Step 5) kept failing there for network
> reasons, so the work resumes here. This file is the state of the world plus what remains.
> `DEPLOY.md` (in this repo) is the full runbook — this file overrides it wherever they differ.
>
> **Do not commit this file.** It holds the account ID and DB endpoint. It holds no secrets
> and must never be given any (see "Rules").
>
> Note for the repo: `AGENTS.md` says this Next.js has breaking changes. That only matters if
> you edit app code — deployment needs no code changes.

## 0. Facts

| Thing | Value |
|---|---|
| AWS account ID | `416121583611` |
| Region (use for **everything**) | `ap-south-1` (Mumbai) |
| IAM user for the CLI | `Kamran_03` (has `AdministratorAccess`) |
| RDS instance | `magpie-db`, PostgreSQL, endpoint `magpie-db.cde4oumimccv.ap-south-1.rds.amazonaws.com:5432` |
| Database / user | `magpie_dev` / `magpie` (password is in the secret below — never print it) |
| RDS security group | the VPC's **`default`** SG `sg-07ff0fefc1f3d891b` — *not* `magpie-db-sg` as the guide says |
| ECR repo | `magpie` → `416121583611.dkr.ecr.ap-south-1.amazonaws.com/magpie` |
| Image URI to deploy | `416121583611.dkr.ecr.ap-south-1.amazonaws.com/magpie:latest` |
| Source | https://github.com/akkki007/magpie.git (public, `main`) |

## 1. What is already done (Steps 1–4)

- **Account + IAM user** exist. Console login is by account email + password.
- **RDS** `magpie-db` is created, publicly accessible, and reachable — `prisma migrate deploy`
  ran against it from the first laptop. It sits in the default SG, which has an inbound
  PostgreSQL rule for the **first laptop's IP** only.
- **Migrations:** all 19 applied. `bun run db:generate` ran.
- **Seeding:** `bun run seed` first failed with `P1011 self signed certificate in certificate
  chain` because the connection string had `sslmode=require`. The fix is `sslmode=no-verify`.
  It was then re-run, but **the user never confirmed all three seeds finished**
  (`seed`, `seed:database`, `seed:board`). Treat as **unverified** — see Step A below.
- **Secrets Manager:** the user reported Step 4 complete. Expected secrets, all **Plaintext**:
  `magpie/DATABASE_URL` (uses `?sslmode=no-verify`), `magpie/BETTER_AUTH_SECRET`,
  `magpie/OPENAI_API_KEY`, and `magpie/RESEND_API_KEY` (optional — skippable). Verify the
  names in Step B below; a typo here fails later with a confusing error.
- **ECR repo `magpie`** is created (empty or partly filled with orphan layers — harmless).
- **The image built fine** on laptop 1 (`docker build -t magpie .`, ~41 min, ~1.1 GB
  compressed) but **`docker push` failed every time** with
  `write tcp 192.168.65.1:3128: broken pipe` (Docker Desktop's proxy). Retries, a Docker
  restart, and a laptop reboot did not help. **CloudShell is blocked** on this account:
  *"account verification is in progress… up to two days"*. So: build and push from here.

## 2. Rules

1. **Never put a secret in a prompt, a file, a commit, or an image layer.** That means the DB
   password, the AWS secret key, OpenAI/Resend keys. The Dockerfile deliberately bakes a
   *fake* `DATABASE_URL` — keep it that way.
2. **Stay in `ap-south-1`.** A split-region deploy fails in confusing ways.
3. **Do not change app code or the Dockerfile** to make a deploy step pass. If a step fails,
   diagnose the infrastructure first. (Exception if the push keeps failing here too: see
   Step C — shrinking the image is a deliberate, user-approved change, not a default.)
4. The **user** does console clicks and pastes secrets; you supply exact values and check
   results. You may run read-only AWS CLI (`describe-*`, `get-*`, `list-*`, `logs`) freely;
   ask before anything that creates, changes, or deletes a resource.

## 3. Setup on this laptop (do once)

Needs: **Docker Desktop** (running), **AWS CLI v2**, **Git**. No Node/Bun needed for the
image — the build happens inside Docker, and the repo is public so no `.env` is required.

```powershell
docker --version ; aws --version ; git --version
```

**Credentials.** The user signs in to the AWS console in the browser, then: IAM → Users →
`Kamran_03` → Security credentials → **Create access key** → CLI. They type it into
`aws configure` themselves (region `ap-south-1`, blank output format):

```powershell
aws configure
aws sts get-caller-identity      # Account must be 416121583611
```

Fresh key only — an earlier key was exposed in a screenshot and must be deleted (see
"Cleanup").

## 4. Step 5 — build and push the image

```powershell
git clone https://github.com/akkki007/magpie.git
cd magpie
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 416121583611.dkr.ecr.ap-south-1.amazonaws.com
docker build -t 416121583611.dkr.ecr.ap-south-1.amazonaws.com/magpie:latest .
docker push 416121583611.dkr.ecr.ap-south-1.amazonaws.com/magpie:latest
```

- `docker build` must run in the repo root (the `.` is the build context).
- **Done when** the push ends with `latest: digest: sha256:… size: …`. Confirm:
  ```powershell
  aws ecr describe-images --repository-name magpie --region ap-south-1
  ```
  It must list an image tagged `latest`.
- ECR login tokens last 12 h. `denied` / `no basic auth credentials` → rerun the login line.
- **If the push fails with `broken pipe` here too, the network is the cause, not Docker.**
  Try a phone hotspot. If that fails too, stop and ask the user about Step C.

### Step A — verify the database has data (do before Step 6)

An app on an empty DB does not error, it shows blank screens. Ask the user to confirm on
laptop 1 that all three seeds finished. If unsure, re-run them (they need Bun and the repo
checked out, plus an inbound 5432 rule for that machine's IP on `sg-07ff0fefc1f3d891b`,
Source **My IP**):

```powershell
$env:DATABASE_URL="postgresql://magpie:<PASSWORD>@magpie-db.cde4oumimccv.ap-south-1.rds.amazonaws.com:5432/magpie_dev?sslmode=no-verify"
$env:DIRECT_URL=$env:DATABASE_URL
bun run seed ; bun run seed:database ; bun run seed:board
```

`<PASSWORD>` is typed by the user, never by you.

### Step B — verify the secrets exist

```powershell
aws secretsmanager list-secrets --region ap-south-1 --query "SecretList[].[Name,ARN]" --output table
```

Expect the `magpie/…` names above. You need each ARN for Step 6b.

### Step C — only if pushing is impossible on every network

Ask the user first. The Dockerfile ships the full `node_modules` by design (no
`output: "standalone"`), which is why the image is ~1.1 GB. Switching to `standalone` would
shrink it a lot but changes how the app runs and must be tested. Do not do it unprompted.

## 5. Step 6 — ECS Fargate (console)

**6a. Cluster.** ECS → Clusters → Create cluster → name `magpie` → AWS Fargate (serverless).

**6b. Task definition.** ECS → Task definitions → Create new:

| Field | Value |
|---|---|
| Family | `magpie` |
| Launch type | AWS Fargate |
| CPU / Memory | 1 vCPU / 2 GB |
| Task execution role | Create new (`ecsTaskExecutionRole`) |
| Container name / port | `web` / `3000` |
| Image URI | `416121583611.dkr.ecr.ap-south-1.amazonaws.com/magpie:latest` |

Plain env vars: `NODE_ENV=production`, `OPENAI_MODEL=gpt-5.6`,
`MAIL_FROM=Magpie <hello@magpie.akkky.tech>`, `BETTER_AUTH_URL=http://placeholder` (real value
in Step 8). From Secrets Manager (**ValueFrom** = the secret ARN): `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`. Leave CloudWatch logging **on**.

**Then give the execution role access to secrets** (the guide mentions this only as a
troubleshooting row, but it is required): IAM → Roles → `ecsTaskExecutionRole` → attach
`SecretsManagerReadWrite`. Skip it and the task dies with
`ResourceInitializationError … secretsmanager`.

**6c. Service + load balancer.** Cluster `magpie` → Services → Create:
Fargate; task family `magpie`, latest revision; service `magpie-svc`; desired tasks `1`.
Networking: **default VPC**, **public** subnets, new SG **`magpie-app-sg`**, **Public IP on**.
Load balancer: Application, name `magpie-alb`, listener HTTP 80, new target group `magpie-tg`
port `3000`, health check path `/`, **success codes `200-399`** (`/` redirects with a 307).
Wait 3–5 min for the task to be **Running** and the target **healthy**.

**6d. Let the app reach the DB.** The DB is in `sg-07ff0fefc1f3d891b` (the default SG), so
edit **that** group: Inbound rules → Add rule → PostgreSQL, 5432, Source **Custom** →
`magpie-app-sg`. Confirm RDS and ECS are in the same VPC.

## 6. Step 7 — HTTPS (mandatory)

Secure cookies are on in production; over plain `http://` sign-up appears to work, then
silently logs the user out.

- **Own a domain?** ACM (ap-south-1) → request certificate → DNS validation → add the CNAME →
  add an HTTPS:443 listener on `magpie-alb` forwarding to `magpie-tg` → CNAME the app hostname
  to the ALB's DNS name. **The guide's `magpie-aws.akkky.tech` belongs to the repo author, not
  this user — use their own domain or the option below.**
- **No domain (likely).** Put a **CloudFront** distribution in front of the ALB: origin =
  the ALB; cache policy **CachingDisabled**; origin request policy **AllViewer**. The defaults
  strip cookies and buffer responses, breaking sign-in and agent streaming. Result:
  `https://xxxx.cloudfront.net`. The ALB only has an HTTP:80 listener, so set the origin
  protocol to **HTTP only**.

## 7. Step 8 — real URL

ECS → Task definitions → `magpie` → **Create new revision** → set `BETTER_AUTH_URL` to the
final `https://…` address (CloudFront URL or own domain) → Create → cluster → `magpie-svc` →
**Update service** → new revision → tick **Force new deployment**.

## 8. Step 9 — check it works

- [ ] Landing page loads over `https://`
- [ ] Sign up at `/sign-up` → lands on `/workspace`
- [ ] **Refresh — still signed in** (proves HTTPS + secure cookies)
- [ ] `/workspace` shows the seeded model grid; an edited cell survives reload
- [ ] `/recon` shows the review queue with real numbers
- [ ] An agent run **streams word by word** (proves the load balancer isn't buffering)

Logs when something 500s: ECS → cluster → Tasks → the task → Logs (CloudWatch).

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Task `PROVISIONING` then stops | Can't reach ECR | Service network config → Public IP **on** |
| `ResourceInitializationError … secretsmanager` | Execution role can't read secrets | Attach `SecretsManagerReadWrite` to `ecsTaskExecutionRole` |
| Target group **unhealthy**, task restarts | Health check failing | Path `/`, success `200-399`, port `3000` |
| Signs in then logs out | Secure cookie over HTTP | Finish Step 7; `BETTER_AUTH_URL` must be `https://` |
| `P1001` / DB timeout from the app | SG rule missing | 6d on `sg-07ff0fefc1f3d891b`; same VPC and region |
| `self-signed certificate` from the app | RDS CA not trusted | `magpie/DATABASE_URL` must end `sslmode=no-verify`; then force a new deployment |
| Every page is empty | DB has tables, no data | Step A |
| Push `broken pipe` | Network / Docker proxy | Other network or hotspot; Step C only with approval |

## 10. Cleanup (before finishing)

- [ ] IAM → `Kamran_03` → Security credentials → **delete the old exposed access key**, and
      the key made for this laptop once the deploy is done.
- [ ] `aws configure` leaves credentials in `%USERPROFILE%\.aws\credentials` — delete that
      file on this laptop.
- [ ] Sign out of the console.
- [ ] RDS master password: it is short and guessable, on a publicly reachable DB. Rotate it
      via RDS → Modify, then **update `magpie/DATABASE_URL`** and force a new ECS deployment.
- [ ] After judging, delete the ECS service, the ALB, the CloudFront distribution, and the
      RDS instance so they stop charging (see `DEPLOY.md` for the cost estimate).
