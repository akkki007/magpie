# Magpie — Auth Plan

> Status: **planned, not built.** Broken into tasks A1–A12 in `learning/path.ts`, which
> holds the live status of each one. Revised 2026-08-30: the library changed from Auth.js to
> Better Auth (§2), and §4's claim that a layout can act as the gate was wrong on Next 16
> and has been corrected.

## 1. What auth has to be, given what Magpie is

Magpie is a multi-tenant workspace where the unit of collaboration is an **Organisation**,
not a user. Everything downstream — models, scenarios, comments, audit logs, agent runs —
is scoped to an org and gated by a role. So auth is not a login form; it is the tenancy
boundary. Getting the shape right now costs a day. Getting it wrong costs a migration
across every table in §2 of the modelling plan.

## 2. Decision: Better Auth with a Prisma adapter, database sessions

**Why not roll our own:** session fixation, CSRF on credential posts, token rotation, and
OAuth state handling are solved problems with sharp edges. No upside in re-solving them.

**Why not Auth.js v5 (NextAuth), which this plan originally specified:** because the
combination this section requires — **email/password *and* database sessions** — is one
Auth.js refuses to build. Its Credentials provider is JWT-only, and configuring it against
`strategy: "database"` throws `UnsupportedStrategy`, documented as *"thrown when a
Credentials provider is present but the JWT strategy is not enabled"*
([authjs.dev/reference/core/errors](https://authjs.dev/reference/core/errors)). The
community workaround — overriding `jwt.encode` to mint a session token and inserting the
session row from the `signIn` callback — fights the library at precisely the point where it
has said no, and is the first thing to break on a minor upgrade. Since instant revocation is
the whole reason for database sessions, giving it up was not on the table; so the library
moved instead.

Better Auth gives us the required shape directly: email/password as a first-class provider,
database sessions as the only session model, a Prisma adapter against our own Postgres, and
an `organization` plugin whose `organization` / `member` / `invitation` tables are the ones
in §3 anyway. It is also on Next's own recommended list in
`node_modules/next/dist/docs/01-app/02-guides/authentication.md`.

**What we give up by not hand-rolling it:** the session layer is about 150 lines we now
don't write, and don't learn from. Accepted deliberately — the tenancy model in §3 and the
gate in §4 are ours either way, and that is where the interesting design actually is.

**Why not Clerk / WorkOS:** the requirement is *local Postgres*. A hosted identity provider
puts the user table outside the database that owns every foreign key to it, which makes
`member.userId` a cross-system reference and joins impossible. Revisit only if SAML/SCIM
becomes a real sales requirement — at which point WorkOS is the right answer, and the
`user`/`member` split below is exactly what makes that swap survivable.

**Why database sessions over JWT:** finance workspace. We need instant revocation ("remove
this person from the org"), a visible active-session list, and role changes that take effect
now rather than on token expiry. A JWT's whole advantage is not hitting the DB — and we hit
the DB on every request anyway.

**Providers, in order:**
1. **Email + password** (credentials), Argon2id hashing. The default for a local-first
   prototype and for demos without internet.
2. **Google OAuth** — the realistic path for finance teams on Workspace.
3. **Email magic link** — built, over Gmail SMTP; see §10, which also covers the credential
   rule it exposed. Will be the invite acceptance flow too.

SAML/SSO is explicitly out of scope for v1 and belongs to the WorkOS swap above.

## 3. Data model

We do not hand-write these. Better Auth generates the schema from `lib/auth.ts` via
`bunx @better-auth/cli generate`, and `prisma migrate dev` turns it into SQL. The shape:

```prisma
user          id, email @unique, emailVerified, name, image, createdAt
account       // password credential AND OAuth linkage, both live here
session       id, token @unique, userId, expiresAt, ipAddress, userAgent
verification  // email verify, password reset, magic link

organization  id, name, slug @unique, createdAt        // ← the org plugin
member        id, userId, organizationId, role, createdAt
invitation    id, organizationId, email, role, status, expiresAt, inviterId
```

Two things to notice, because they are the whole reason this shape is safe. The password
hash lives on `account`, not `user` — so "has a password" and "has a Google login" are two
rows of the same kind, and adding a provider never touches the user. And `member` is a join
table that *carries data*: the role is a property of the relationship, not of the person.
The same human is OWNER of their own org and VIEWER of a client's.

`Role = OWNER | ADMIN | EDITOR | VIEWER`, defined as access-control statements rather than
a Postgres enum (`createAccessControl` from `better-auth/plugins/access`). A role becomes a
set of `resource: [actions]` pairs:

- **OWNER** — billing, delete org, transfer ownership. Exactly one per org, enforced.
- **ADMIN** — invite/remove members, manage data sources.
- **EDITOR** — create and edit models, run agents, accept changesets.
- **VIEWER** — read models, comment. Cannot accept an AI changeset.

*Why statements and not an enum with an ordering:* the moment you write `role >= EDITOR` you
have asserted that roles form a line, and they don't. VIEWER can comment; if we ever add a
BILLING role that can pay invoices but not read a model, an ordering has no answer for it.
Asking `can({ changeset: ["accept"] })` keeps the question at the level the code actually
cares about, and the answer stays readable at the call site.

A user can belong to several orgs; the active org lives in the URL (`/[orgSlug]/...`), not
in the session. *Why:* URL-scoped tenancy means a shared link opens the right workspace,
two tabs can hold two orgs, and no server action can be tricked by a stale "current org"
cookie into writing to the wrong tenant.

**This is a rule we have to actively hold.** Better Auth's org plugin offers the other
model: `organization.setActive()` writes an `activeOrganizationId` onto the session row, and
every org API defaults to it when you pass no id. That default is exactly the stale cookie
described above — two tabs share one session row, so opening a second org in a new tab
silently retargets the first. So: **we never call `setActive`, and we never read
`activeOrganizationId` for an authorisation decision.** The org is resolved from the URL
slug every time (`getFullOrganization({ query: { organizationSlug } })`), which takes a slug
and does not touch session state. `setActive` may be used later for a purely cosmetic
"last workspace you visited" redirect on `/`, and for nothing else.

## 4. Route and enforcement structure

```
app/
  (marketing)/            page.tsx            ← landing, public
  (auth)/
    sign-in/  sign-up/  forgot-password/  reset-password/  verify-email/
    invite/[token]/
  (app)/
    [orgSlug]/
      layout.tsx          ← shell + nav. NOT a gate. See below.
      page.tsx            ← model list; calls requireMembership itself
      models/[modelId]/   ← the modelling workspace; calls it itself
  onboarding/             ← create-first-org, for users with zero memberships
lib/authz.ts              ← requireMembership: the actual gate
proxy.ts                  ← Next 16's middleware; coarse redirects only
```

**Two layers, and one thing that is not a layer:**

1. `proxy.ts` — cheap cookie presence check, redirects unauthenticated traffic away from
   `(app)`. This is UX, **not** security. It runs before the DB, it runs on every prefetch,
   and it can be wrong. (Next 16 renamed Middleware to Proxy; same thing, new file name.)
2. **Every page, server action, and route handler** calls
   `requireMembership(orgSlug, permission?)`, which returns `{ user, org, role, can }` or
   throws. It resolves the org from the slug it was handed, loads the membership, and
   `notFound()`s if there isn't one — a 404, not a 403, so we don't leak which orgs exist.
   Wrapped in React's `cache()` so six components on one page cost one query.

And the thing that is not a layer: **the layout.** The original draft of this plan made
`[orgSlug]/layout.tsx` the real gate. That is wrong on Next 16, and the docs shipped in this
repo say so directly:

> A layout also does not control whether the rest of the route renders. Route segments and
> parallel route slots are rendered by the router, so a layout that hides or swaps them does
> not stop them from running or from appearing in the RSC Payload.
> — `node_modules/next/dist/docs/01-app/02-guides/authentication.md`

Two separate failures hide in there. A layout that decides "no membership → render nothing"
does not stop `page.tsx` beneath it from running its queries, and the data it fetched still
ships in the RSC payload. And because layouts do not re-render on client-side navigation,
a check that lives only in the layout is not re-run when the user moves between routes
inside it. Add the long-standing third: a Server Action is a public POST endpoint that
merely happens to sit next to a protected page, and no layout has ever protected one.

So the check goes next to the data, every time, and the layout is just a shell. The cost is
that it is easy to forget — which is exactly why `requireMembership` returns the org and the
role you need to render, and not just a boolean. Forgetting to call it means you have no
data to render, rather than rendering someone else's.

## 5. Session and security specifics

- Cookies: `httpOnly`, `sameSite: "lax"`, `secure` in production, `__Host-` prefix.
- Session lifetime 30 days, sliding, refreshed at most daily (`session.updateAge`) to avoid
  a write per request.
- **`session.cookieCache` stays off.** Better Auth can cache the session in a signed cookie
  for a few seconds so it can skip the lookup. That is the JWT trade-off reintroduced under
  another name: for the length of the cache window, a revoked session still works and a
  changed role has not changed. Revocation is why we picked database sessions in §2, so we
  do not buy it back a second time. Revisit only with a measured query cost to point at.
- Password: min 12 chars, checked against a common-password list. No composition rules —
  length beats symbols. Better Auth hashes with scrypt by default; the plan originally
  specified Argon2id (`memoryCost 19456, timeCost 2, parallelism 1`), which slots in via
  `emailAndPassword.password.{hash,verify}`. Decide this by measuring both — a hash under
  ~50ms is too cheap and over ~500ms is a self-inflicted DoS on your own sign-in route.
- Rate limiting on sign-in, sign-up, forgot-password, and invite acceptance. In-memory
  token bucket keyed by IP + email for local dev; swap for Postgres-backed or Redis before
  any deployment.
- Sign-in responses are **constant-shape**: "invalid email or password" regardless of which
  was wrong, and the same timing for existing and non-existing users.
- Reset tokens: single-use, 1 hour, hashed at rest, and invalidate all sessions on use.
- Email enumeration: sign-up and forgot-password always return the same success state.
- Account linking: only for providers we trust to have verified the email. An OAuth provider
  that hands back an unverified address, auto-linked to an existing account, is account
  takeover with extra steps.
- CSRF: Better Auth handles its own endpoints; server actions get Next's built-in origin
  check — keep `serverActions.allowedOrigins` tight.

## 6. Flows to build

| Flow | Notes |
|---|---|
| Sign up (email) | → verify email → onboarding → create org → workspace |
| Sign up (Google) | Auto-verified → onboarding |
| Sign in | Both providers; "remember me" is the default, not a checkbox |
| Forgot / reset password | Hashed single-use token, invalidates sessions |
| Invite member | Admin sends → tokenised link → accept (sign in or sign up first) → membership |
| Switch org | Org switcher in the rail; navigates to `/[otherSlug]` |
| Onboarding | Only for users with zero memberships; asks org name, derives slug |
| Sign out | Deletes the session row, not just the cookie |

## 7. Design notes (must match `docs/design-system.md`)

Auth screens are the first product surface a user touches, so they set the tone: centred
card, max 400px, white on `--bg-app`, 1px `--border`, radius 12, `--elev-1`. Logo orb above
the title. Title 20/600 `--text-primary`, helper 15 `--text-muted`. Inputs 40px, radius 8,
`--blue-200` focus ring. One `--blue-600` primary button, full width. OAuth button is
secondary with the provider mark. Errors are inline under the field in `--neg-fg`, never a
toast. No illustrations, no gradients, no split-screen marketing panel — the restraint *is*
the brand.

## 8. Build order

Tracked as phase A in `learning/path.ts`, which is the live status — this list is the
reasoning, that file is the state.

1. **A1** Postgres + Prisma client + one migration, to prove the pipe works.
2. **A2** `lib/auth.ts` with email/password, `bunx @better-auth/cli generate`, migrate.
3. **A3** The organization plugin, and OWNER/ADMIN/EDITOR/VIEWER as access-control
   statements.
4. **A4** Seed a demo org with one member at each role.
5. **A5** `requireMembership()` in `lib/authz.ts`, with tests.
6. **A6** `(app)/[orgSlug]` routes, `notFound()` for non-members, `proxy.ts` in front.
7. **A7** Sign-in / sign-up UI on the design system.
8. **A8** Onboarding + org creation, in one transaction.
9. **A9** Sign out + session revocation + the active-session list.
10. **A10** Invites + member management.
11. **A11** Google provider.
12. **A12** Rate limiting + a security pass against §5 as a checklist.

A1–A6 are what the modelling module actually blocks on: it needs the tables, the tenancy
boundary, and a working `requireMembership` to hang every query off. A7–A12 are the product
surface around that boundary and can land alongside M0/M1.

Password reset and email verification are deliberately not on this list yet — both need the
mail path (Resend vs local SMTP catcher) decided first, and neither blocks anything.

## 9. What is actually built (2026-08-30)

**A1, A2 and A7 are in the repo and work end to end**: sign up → session row → protected
page → sign out deletes the row. `/workspace` is a stand-in for `/[orgSlug]`, which arrives
with A3–A6. Files: `prisma/schema.prisma`, `lib/db.ts`, `lib/auth.ts`, `lib/session.ts`,
`app/api/auth/[...all]/route.ts`, `app/(auth)/*`, `app/(app)/workspace/page.tsx`,
`proxy.ts`.

Four things the plan did not anticipate, each of which cost a debugging pass:

1. **The Better Auth CLI lags the library.** `@better-auth/cli` is published separately and
   tops out at `1.5.0-beta` against `better-auth@1.7.2`. Its generated schema is missing
   `account.issuer`, a required column the running library writes on every sign-up — so
   following §3's instruction to trust the generator produces a schema that migrates
   cleanly and then fails on the first real sign-up. `bun run auth:tables` prints what the
   *installed* library expects, read from `getAuthTables()`, and is the source of truth
   until the CLI catches up.
2. **The Prisma adapter does not use transactions by default.** `transaction` defaults to
   `false`. Sign-up writes `user` then `account`; the failure above landed between them and
   left a user with no password row — an account that can neither sign in nor sign up again.
   Now set to `true` in `lib/auth.ts`.
3. **Prisma 7 has no query engine.** Every SQL provider goes through a driver adapter
   (`@prisma/adapter-pg`), the connection URL lives in `prisma7.config.ts` rather than in
   `schema.prisma`, and the generated client is committed-out to `lib/generated/prisma`.
4. **Every export of a `"use server"` file becomes an endpoint**, so it must be an async
   function. `AuthState` and its initial value live in `app/(auth)/form-state.ts` for that
   reason.

Known gaps against §5, all deliberate and none of them silent:

- Sign-up still reveals that an email is registered. Hiding it requires ending sign-up at
  "check your email" instead of at a session, which is blocked on the mail path.
- Sign-in timing is not constant: an unknown email skips the hash comparison and answers
  faster. Belongs with rate limiting in **A12**.
- No rate limiting yet (**A12**), no `__Host-` cookie prefix in dev (it requires HTTPS;
  Better Auth adds the secure prefix automatically in production).
- Password hashing is Better Auth's default scrypt. §5's Argon2id swap is still open and
  should be decided by measuring both.

Local database: `magpie_dev`, owned by a dedicated `magpie` role rather than a personal
superuser — the app should only ever hold rights over its own database. Connection string
in `.env`, which is gitignored.

## 10. Magic link, and the rule it forced us to learn

Provider 3 from §2 is built: `/sign-in/link` emails a one-time link, and opening it signs
you in — creating the account first if the address is new. Mail goes out over Resend
(`lib/mail.ts`), sending from `magpie.akkki.tech`. This started on Gmail SMTP with an app
password and moved once the cost showed up in the flow itself: a fresh SMTP connection —
TCP, TLS, AUTH — ran ~3.5s on every send, and pooling it hangs indefinitely under Bun, so
the four seconds were not negotiable while we still spoke SMTP. Resend is one HTTPS POST
and does the SMTP part on its own side. One variable in `.env`:

```
RESEND_API_KEY="re_..."
MAIL_FROM="Magpie <hello@magpie.akkki.tech>"   # optional, this is the default
```

Leave the key unset and mail is printed to the server log instead of sent, so a fresh clone
can walk the whole flow. `bun run mail:check` proves the key works *and* that the sending
domain is verified, without sending anything — a valid key on an unverified domain is the
failure that would otherwise surface only when a real user asks for a link.

One sharp edge worth knowing: Resend's SDK **returns** failures as `{ data: null, error }`
rather than throwing. Unchecked, every failed send would look like a successful one, and
`sendMagicLink` deliberately awaits `sendMail` so the form can tell the user the link did
not go out. `lib/mail.ts` re-throws to keep that true.

**Why the link is a separate page and not a toggle on `/sign-in`:** a toggle is client
state, so with JavaScript blocked or still loading there is no way to reach the second
form. Two pages both work as plain HTML.

**Tokens are hashed at rest** (`storeToken: "hashed"`). The default stores the link token in
`verification` in plain text, which makes a moment of read access to that table equivalent
to a session for every user with an unexpired link. Same reasoning as never storing a
password: the database must not hold anything that is itself a credential. Ten-minute
expiry, consumed atomically on first use — a second open lands on `/sign-in/link?error=`.

**The rule worth remembering.** Better Auth treats `emailVerified: false` as *no proof that
this row's password belongs to the mailbox owner*. So when a magic link resolves to an
unverified user, `revokeUnprovenAccountAccess` deletes every account link and revokes every
session that predates the link, then flips the row to verified. That is correct — it stops
someone who signed up with your address from keeping access once you prove the address is
yours — but combined with §2's "verification is deferred", it meant **one emailed link
silently erased the password of every user in the database.** We reproduced it: sign up,
request a link, and the `account` row is gone.

The fix is not to fight the library, it is to stop leaving accounts unproven:
`emailVerification.sendOnSignUp` is now on, so sign-up sends a confirmation mail (it does
not *require* the click — an unverified user can still work). Verified users keep their
password when they use a link; unverified ones do not, and `/workspace` says so in as many
words. This also closes the item §8 deferred: email verification is built, and password
reset is now unblocked.

Two smaller consequences, both deliberate:

- `autoSignInAfterVerification` is **off**. On, it would mint a session for whoever opens
  the confirmation link — a second magic link with six times the lifetime, on the one email
  people forward.
- The verification sender swallows and logs SMTP failures; the magic-link sender does not.
  Better Auth awaits the verification mail *after* committing the user and account rows, so
  an outage would report "sign-up failed" for an account that now exists — and the retry
  would be told the email is taken. Losing that mail is recoverable; losing the account is
  not. For magic link the opposite holds: the email *is* what was asked for, so a failure
  has to be said out loud.

Still open: the action calls `auth.api` in process, so Better Auth's rate limiter — which
guards the HTTP endpoint — never sees it. Anyone can drive the "email me a link" form in a
loop. **A12 has to add a limiter at the action layer**, not just at the API.
