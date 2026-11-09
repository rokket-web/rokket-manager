# Neon setup guide

Project: **Rokket Management** (`aws-us-east-2`, Postgres 18).

## Branches

| Branch                 | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `production` (default) | Production data. Never used for local work.                        |
| `Dev`                  | Long-lived local development. **Must have no expiry** (see below). |
| `ci-<run>-<attempt>`   | Created and deleted by GitHub Actions per CI run.                  |

> The `Dev` branch had an auto-delete expiry; it was removed on 2026-11-09. Keep it unset.

## Connection strings

Neon console -> Connect, choose the branch, role and database.

- **Pooled** (host contains `-pooler`) -> `DATABASE_URL`. Used by the app at runtime.
- **Direct** (toggle "Connection pooling" off) -> `DIRECT_URL`. Used only by Prisma migrations.

Put both in `.env.local` (gitignored; `.env.example` documents every variable). Never commit them.

## Local workflow

1. `cp .env.example .env.local` and fill in the `Dev` branch URLs, `BETTER_AUTH_SECRET`, `SEED_PASSWORD`.
2. `npx prisma migrate deploy` (apply committed migrations) or `npm run db:migrate` (create a new one).
3. `npm run db:seed`, then `npm run dev`.
4. Reset `Dev` to production's schema/data any time: Neon console -> Dev -> Reset from parent.

## CI

Repo secrets/variables: `NEON_API_KEY` (secret), `NEON_PROJECT_ID` (variable), `SEED_PASSWORD` (secret).

## Roles

Migrations use the owner role over `DIRECT_URL`. A least-privilege app role for `DATABASE_URL` is
recommended before launch (Phase 6 checklist).

## Backups

Point-in-time restore window on this project is currently **6 hours** (`history_retention_seconds = 21600`).
Review before launch (Phase 6).
