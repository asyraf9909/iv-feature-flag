# GitHub Copilot Instructions

## Project Overview

This is a **feature flag service** — a REST API that lets you toggle features on/off for specific users, groups, or regions without deploying code. It is written in **TypeScript** and uses **Express**, **PostgreSQL** (`pg`), and **Zod** for validation.

## Architecture

Three strict layers with one-way dependencies: `core` ← `infrastructure` ← `api`

```
src/
  core/           # Pure domain logic — no I/O, no framework dependencies
  infrastructure/ # PostgreSQL implementation of the repository interface
  api/            # Express HTTP layer (routes, middleware, app factory)
```

### `src/core/`
- **types.ts** — all shared domain types: `FeatureFlag`, `Override`, `EvaluationContext`, `EvaluationResult`
- **IFeatureFlagRepository.ts** — repository interface; the only persistence contract `core` knows about
- **EvaluationEngine.ts** — stateless pure function; takes a `FeatureFlag` + `EvaluationContext`, returns `EvaluationResult`
- **FeatureFlagService.ts** — orchestrates repository + engine; owns a 30-second in-process TTL cache (`Map<string, CacheEntry>`)
- **errors.ts** — `NotFoundError`, `ConflictError`, `ValidationError`; mapped to HTTP status codes by the error handler

### `src/infrastructure/`
- **db.ts** — singleton `pg.Pool` constructed from `DATABASE_URL`
- **migrations.ts** — `CREATE TABLE IF NOT EXISTS` for `feature_flags` and `overrides`; runs at startup
- **PostgresFeatureFlagRepository.ts** — implements `IFeatureFlagRepository`; maps snake_case DB columns to camelCase domain types

### `src/api/`
- **app.ts** — `createApp(service)` factory that wires routes, static files (`public/`), and the error handler; accepts an injected `FeatureFlagService` so tests can swap in an in-memory repo
- **routes/flags.ts** — all flag routes; Zod schemas validate requests before passing to the service
- **middleware/errorHandler.ts** — maps domain errors to HTTP status codes

## Key Invariants

- **Flag names are immutable** and must match `/^[a-zA-Z0-9_-]+$/`. Enforced in both the service (`validateName`) and the Zod schema on the route.
- **Evaluation precedence** (highest wins): `user override → group override → region override → global default`. Implemented in `EvaluationEngine.evaluate`.
- **Override upsert is idempotent** — `PUT /api/flags/:name/overrides` uses `ON CONFLICT ... DO UPDATE` in Postgres and a keyed map in the in-memory repo.
- **Cache invalidation**: write operations (`upsertOverride`, `deleteOverride`, `deleteFlag`) call `this.cache.delete(flagName)` immediately; `updateFlag` replaces the cache entry; `listFlags` bypasses the cache entirely.
- **DB schema**: `feature_flags(id, name UNIQUE, description, global_enabled, ...)` + `overrides(id, flag_name FK→CASCADE, override_type, target_id, enabled, ...)` with a unique constraint on `(flag_name, override_type, target_id)`.

## Dependency Injection Pattern

`createApp` takes a `FeatureFlagService`; `FeatureFlagService` takes an `IFeatureFlagRepository`. Tests avoid a real DB by wiring an `InMemoryRepository` directly into the service and app.

## Testing

Tests live in `tests/` and mirror the `src/` structure. No database is required to run them.

```bash
npm test                  # all tests
npm run test:coverage     # with coverage report (≥70% lines enforced)
npx jest tests/core/EvaluationEngine.test.ts  # single file
```

## Common Commands

```bash
npm run dev               # run with ts-node (no compile step)
npm run build             # compile to dist/ via tsconfig.build.json
npm start                 # run compiled output

docker compose up -d postgres   # start only the DB
docker compose up -d            # start DB + app container
```

Environment: copy `.env.example` to `.env`. Defaults work with `docker compose` out of the box (`DATABASE_URL`, `PORT=3000`).
