# Magpie — Auth Plan

> Status: **plan only.** To be implemented after the landing page, before modelling.

## 1. What auth has to be, given what Magpie is

Magpie is a multi-tenant workspace where the unit of collaboration is an **Organisation**,
not a user. Everything downstream — models, scenarios, comments, audit logs, agent runs —
is scoped to an org and gated by a role. So auth is not a login form; it is the tenancy
boundary. Getting the shape right now costs a day. Getting it wrong costs a migration
across every table in §2 of the modelling plan.

## 2. Decision: Auth.js v5 (NextAuth) with a Prisma adapter, database sessions

**Why not roll our own:** session fixation, CSRF on credential posts, token rotation, and
OAuth state handling are solved problems with sharp edges. No upside in re-solving them.

**Why not Clerk / WorkOS:** the requirement is *local Postgres*. A hosted identity provider
puts the user table outside the database that owns every foreign key to it, which makes
`Membership.userId` a cross-system reference and joins impossible. Revisit only if SAML/SCIM
becomes a real sales requirement — at which point WorkOS is the right answer, and the
`User`/`Membership` split below is exactly what makes that swap survivable.

**Why database sessions over JWT:** finance workspace. We need instant revocation ("remove
this person from the org"), a visible active-session list, and role changes that take effect
now rather than on token expiry. A JWT's whole advantage is not hitting the DB — and we hit
the DB on every request anyway.

**Providers, in order:**
1. **Email + password** (credentials), Argon2id hashing. The default for a local-first
   prototype and for demos without internet.
2. **Google OAuth** — the realistic path for finance teams on Workspace.
3. **Email magic link** — cheap to add once an SMTP/Resend path exists; also the invite
   acceptance flow.

SAML/SSO is explicitly out of scope for v1 and belongs to the WorkOS swap above.

## 3. Data model

```prisma
User        id, email @unique, emailVerified, name, image, passwordHash?, createdAt
Account     // Auth.js OAuth linkage
Session     id, sessionToken @unique, userId, expires   // DB sessions
VerificationToken                                        // magic link + email verify

Organisation  id, name, slug @unique, createdAt
Membership    id, userId, orgId, role, createdAt   @@unique([userId, orgId])
Invite        id, orgId, email, role, token @unique, expiresAt, acceptedAt, invitedById
```

`Role = OWNER | ADMIN | EDITOR | VIEWER`.

- **OWNER** — billing, delete org, transfer ownership. Exactly one per org, enforced.
- **ADMIN** — invite/remove members, manage data sources.
- **EDITOR** — create and edit models, run agents, accept changesets.
- **VIEWER** — read models, comment. Cannot accept an AI changeset.

A user can belong to several orgs; the active org lives in the URL (`/[orgSlug]/...`), not
in the session. *Why:* URL-scoped tenancy means a shared link opens the right workspace,
two tabs can hold two orgs, and no server action can be tricked by a stale "current org"
cookie into writing to the wrong tenant.

## 4. Route and enforcement structure

```
app/
  (marketing)/            page.tsx            ← landing, public
  (auth)/
    sign-in/  sign-up/  forgot-password/  reset-password/  verify-email/
    invite/[token]/
  (app)/
    [orgSlug]/
      layout.tsx          ← resolves org + membership, or 404
      page.tsx            ← model list
      models/[modelId]/   ← the modelling workspace
  onboarding/             ← create-first-org, for users with zero memberships
proxy.ts                  ← Next 16's middleware; coarse redirects only
```

**Three layers, deliberately:**

1. `proxy.ts` — cheap cookie presence check, redirects unauthenticated traffic away from
   `(app)`. This is UX, **not** security. It runs before the DB and can be wrong.
2. `(app)/[orgSlug]/layout.tsx` — the real gate. Loads the session, resolves the org by
   slug, loads the membership. No membership → `notFound()` (a 404, not a 403; don't leak
   which orgs exist).
3. **Every server action and route handler** re-checks. `requireMembership(orgSlug, minRole)`
   returns `{ user, org, role }` or throws. Layouts do not protect server actions — an
   action is a public POST endpoint that happens to be colocated. This is the single most
   common Next.js auth mistake and it will not be made here.

## 5. Session and security specifics

- Cookies: `httpOnly`, `sameSite: "lax"`, `secure` in production, `__Host-` prefix.
- Session lifetime 30 days, sliding, refreshed at most daily to avoid a write per request.
- Password: Argon2id (`memoryCost 19456, timeCost 2, parallelism 1`), min 12 chars,
  checked against a common-password list. No composition rules — length beats symbols.
- Rate limiting on sign-in, sign-up, forgot-password, and invite acceptance. In-memory
  token bucket keyed by IP + email for local dev; swap for Postgres-backed or Redis before
  any deployment.
- Sign-in responses are **constant-shape**: "invalid email or password" regardless of which
  was wrong, and the same timing for existing and non-existing users.
- Reset tokens: single-use, 1 hour, hashed at rest, and invalidate all sessions on use.
- Email enumeration: sign-up and forgot-password always return the same success state.
- CSRF: Auth.js handles its own; server actions get Next's built-in origin check — keep
  `serverActions.allowedOrigins` tight.

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

1. Prisma schema + `bunx prisma migrate dev` + seed a demo org and user.
2. Auth.js config, credentials provider, DB sessions, `auth()` helper.
3. `requireMembership()` + the `(app)/[orgSlug]/layout.tsx` gate.
4. Sign-in / sign-up / sign-out UI.
5. Onboarding + org creation.
6. Google provider.
7. Invites + member management.
8. Password reset + email verification (needs the mail path decided).
9. Rate limiting + a security pass against §5 as a checklist.

Steps 1–4 unblock the modelling module; 5–9 can land alongside M0/M1.
