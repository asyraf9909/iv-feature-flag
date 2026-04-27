# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # run with ts-node (no compile step)
npm run build        # compile to dist/ via tsconfig.build.json
npm start            # run compiled output

# Testing
npm test             # all tests (no DB required)
npm run test:coverage  # with coverage report (≥70% lines enforced)

# Run a single test file
npx jest tests/core/EvaluationEngine.test.ts

# Infrastructure
docker compose up -d postgres   # start only the DB
docker compose up -d            # start DB + app container
```

Environment: copy `.env.example` to `.env`. The defaults work with `docker compose` out of the box (`DATABASE_URL`, `PORT=3000`).

## Architecture

The project is a three-layer feature flag service with strict dependency flow: `core` ← `infrastructure` ← `api`.

**`src/core/`** — pure domain logic, zero I/O, zero framework dependencies.
- [types.ts](src/core/types.ts) — all shared domain types (`FeatureFlag`, `Override`, `EvaluationContext`, `EvaluationResult`, etc.)
- [IFeatureFlagRepository.ts](src/core/IFeatureFlagRepository.ts) — repository contract; the only thing `core` knows about persistence
- [EvaluationEngine.ts](src/core/EvaluationEngine.ts) — stateless pure function; takes a `FeatureFlag` + `EvaluationContext`, returns `EvaluationResult`
- [FeatureFlagService.ts](src/core/FeatureFlagService.ts) — orchestrates the repository and engine; owns a 30-second in-process TTL cache (`Map<string, CacheEntry>`)
- [errors.ts](src/core/errors.ts) — `NotFoundError`, `ConflictError`, `ValidationError`; the error handler in `api/` maps these to HTTP status codes

**`src/infrastructure/`** — PostgreSQL implementation of the repository interface.
- [db.ts](src/infrastructure/db.ts) — singleton `pg.Pool` constructed from `DATABASE_URL`
- [migrations.ts](src/infrastructure/migrations.ts) — `CREATE TABLE IF NOT EXISTS` for `feature_flags` and `overrides`; runs at startup
- [PostgresFeatureFlagRepository.ts](src/infrastructure/PostgresFeatureFlagRepository.ts) — implements `IFeatureFlagRepository` using `pg`; maps snake_case DB columns to camelCase domain types

**`src/api/`** — Express HTTP layer.
- [app.ts](src/api/app.ts) — factory function `createApp(service)` that wires up routes, static files (`public/`), and the error handler; accepts an injected `FeatureFlagService` so tests can swap in an in-memory repo
- [routes/flags.ts](src/api/routes/flags.ts) — all flag routes; uses Zod schemas for request validation before passing to the service
- [middleware/errorHandler.ts](src/api/middleware/errorHandler.ts) — maps domain errors to HTTP status codes

**Dependency injection pattern**: `createApp` takes a `FeatureFlagService`; `FeatureFlagService` takes an `IFeatureFlagRepository`. This is how tests avoid a real DB — the API tests in [tests/api/flags.test.ts](tests/api/flags.test.ts) wire an `InMemoryRepository` directly into the service and app.

## Key invariants

- **Flag names are immutable** and must match `/^[a-zA-Z0-9_-]+$/`. Enforced in both the service (`validateName`) and the Zod schema on the route.
- **Override upsert is idempotent** — `PUT /api/flags/:name/overrides` uses `ON CONFLICT ... DO UPDATE` in Postgres and a keyed map in the in-memory repo.
- **Evaluation precedence** (highest wins): user override → group override → region override → global default. Implemented in `EvaluationEngine.evaluate`.
- **Cache invalidation**: write operations (`upsertOverride`, `deleteOverride`, `deleteFlag`) call `this.cache.delete(flagName)` immediately; `updateFlag` replaces the cache entry. `listFlags` bypasses the cache entirely.
- **DB schema**: `feature_flags(id, name UNIQUE, description, global_enabled, ...)` + `overrides(id, flag_name FK→CASCADE, override_type, target_id, enabled, ...)` with a unique constraint on `(flag_name, override_type, target_id)`.
