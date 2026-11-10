# Rokket Manager

Internal agency tool + client portal: clients, projects/time, portal, quotes/invoices/payments.
Built in phases (see Roadmap); each phase on its own branch, stopping for review.

## Stack

Next.js 16 (App Router, Node runtime) + TypeScript, Tailwind v4 + shadcn/ui, Prisma 7 + Neon Postgres,
Better Auth (email/password for Admin/Staff, magic link for Client), Zod, Vitest, Playwright.
Hosting: Render (long-lived Node service). Email: Mailgun (US). Files: Google Drive Shared Drive behind a
Storage interface (Phase 3). Payments: Stripe (Phase 4).

## Commands

`npm run dev` (port 3100, must match BETTER_AUTH_URL) | `build` | `lint` | `typecheck` | `test` | `test:int` (DB integration tests, never prod) | `e2e` | `db:migrate` | `db:deploy` | `db:seed` | `admin:create` (first admin on prod)

## Conventions

- All authorization lives in `src/server` (policies + services). UI hiding is cosmetic only.
- Gate pages/actions with `requireActor([...roles])` (`src/server/authz/session.ts`). `src/proxy.ts` is an
  optimistic cookie check only.
- Validate all input with Zod server-side. Money = integer cents + ISO currency, never floats.
- Money-related writes use short Prisma transactions. Write `audit()` rows inside the same transaction.
- Never commit secrets. Every env var is documented in `.env.example`.

## Architecture decisions

- **Prisma 7**: URLs are not in `schema.prisma`. `prisma.config.ts` uses `DIRECT_URL` for CLI/migrations;
  runtime client (`src/server/db.ts`) uses `@prisma/adapter-pg` over pooled `DATABASE_URL`.
  Generated client: `src/generated/prisma` (gitignored; created by `postinstall`/`db:generate`).
- **Neon scale-to-zero**: pool max 5, 10s idle, 10s connect timeout, `withRetry()` for reads on transient errors.
- **Auth**: sign-up disabled everywhere; Admin creates users; clients are invited (Phase 5). One portal user per
  client (`User.clientId` unique). Inactive users are rejected in `getActor()`.
- Next 16: `cacheComponents` is off (per-user dynamic pages). Middleware is `src/proxy.ts`.
- Neon: branches `production`, `Dev`, per-run `ci-*`. PITR window currently 6h (review in Phase 6).

## Clients module (Phase 2)

- Services: `src/server/services/clients.ts` (all reads/writes); permissions + row scope: `src/server/authz/clients.ts`.
  Admin: full access. Staff: read-only, scoped by `clientScope()` (fails closed: sees none until Phase 3 adds project
  assignment). Client role: no access to internal services.
- Tax: `Client.taxRateBps` (null = default rate setting, 0 = exempt). Parse/format in `src/lib/tax.ts`.
- Every write records an `Activity` (timeline) and an `AuditLog` row in the same transaction.
- CSV: `src/lib/csv.ts` (papaparse); export neutralizes formula injection; import max 500 rows / 1 MB, skips duplicate names.
- Integration tests (`*.int.test.ts`) run against DATABASE_URL and refuse the production endpoint.
- `RATE_LIMIT_OFF=1` disables Better Auth rate limiting for e2e only, and only if BETTER_AUTH_URL is http://localhost.

## Projects module (Phase 3)

- Services: `src/server/services/{projects,tasks,time,files}.ts`; permissions + scope: `src/server/authz/projects.ts`.
  Admin: everything. Staff: only projects they are members of; can manage tasks/comments, log their own time, upload
  files; cannot create/edit/delete projects, manage members/milestones, or see budgets, rates or billable value
  (stripped in the service layer, not the UI). Client role: no internal access.
- Staff client scope (`clientScope`) = clients that have a project the staff user belongs to.
- Time: `TimeEntry.rateCents` is snapshotted at creation; one running timer per user enforced by a partial unique
  index (migration SQL). Amounts use `amountForMinutes()` (integer, half-up per entry) and the dashboard SQL matches it.
- Files: GCS via signed URLs (`src/server/storage`), see `docs/gcs-setup.md`. Storage is resolved AFTER authorization.
- Forms: `FieldForm` (src/components/forms) uses `useId` for field ids. Boolean form values use `boolish()`,
  never `z.coerce.boolean()` (it treats "false" as true).
- Deleting a client with projects is blocked (`Project.client` is onDelete Restrict).

## Billing module (Phase 4)

- Admin-only (`src/server/authz/billing.ts`); staff/clients never see quotes, invoices, payments. Services:
  `src/server/services/{quotes,invoices,payments,stripe-payments,billing-email,billing-docs,billing-core,settings}.ts`.
  Pure math in `src/lib/billing.ts` (integer cents, quantities in thousandths, bps tax, half-up rounding, tax once per document).
- Totals are always recomputed server-side; the editor's preview is cosmetic. Tax rate is snapshotted on save
  (client rate, else `defaultTaxRateBps` setting). Quote -> invoice copies the accepted quote's snapshot.
- Numbers (`INV-0001`, `Q-0001`) are assigned when SENT via the `Sequence` table (gapless, row-locked), so drafts are deletable.
- Invoice payment state changes in ONE place: `recomputeInvoicePayments` (locks the invoice row; `paidCents` = sum of SUCCEEDED
  payment rows). Manual payments and Stripe both go through it. Refunds are negative SUCCEEDED rows (`reference: refund:<chargeId>`),
  applied as a delta from the charge's cumulative `amount_refunded`, so webhook retries and the admin refund action never double count.
- Time -> invoice: `InvoiceLine.timeEntryId` is unique, so time is billed once; voiding frees it.
- Email: `src/server/mail` (Mailgun over fetch). Sending validates recipient + mail config BEFORE locking the document.
  `MAIL_DRIVER=log` (non-production only) logs instead of sending; used by e2e. PDFs: `src/server/pdf/render.ts` (pdf-lib).
- Stripe: hosted Checkout. Public link `/pay/<token>` (random token regenerated on send) creates/reuses a session for the balance.
  Webhook `/api/webhooks/stripe` verifies the signature on the raw body, records `StripeEvent` ids in the same transaction as the
  effects (failure rolls back -> Stripe retries; repeats are no-ops). A live key is refused outside production. See `docs/stripe-setup.md`.
- Voiding an invoice first expires open Checkout sessions; it is refused if one was already paid.
- Known limitation: if a client pays by card after a manual payment covered the balance, the invoice shows overpaid
  (audit meta `overpaidCents`); refund it from the invoice page.
- Client accept/decline links and the portal invoice views are Phase 5; for now the admin records quote responses.

## Deploy (Render)

Build: `npm ci && npm run db:deploy && npm run build` (db:deploy = migrate with cold-start retries). Start: `npm start`.
Health check: `/api/health`.

## Roadmap

1 Foundation (current) | 2 Clients | 3 Projects | 4 Billing | 5 Portal | 6 Hardening/launch
