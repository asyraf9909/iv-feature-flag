# Feature Flag Engine

A production-grade feature flag service built with **Node.js**, **TypeScript**, **Express**, and **PostgreSQL**.

---

## Quick Start (copy-paste friendly)

### Prerequisites
- Node.js 18+
- Docker & Docker Compose

```bash
# 1. Clone and install
git clone <repo-url>
cd feature-flag-engine
npm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Configure environment
cp .env.example .env
# defaults in .env.example work with docker-compose out of the box

# 4. Run the server
npm run dev
```

The server starts on **http://localhost:3000**.

### Production build

```bash
npm run build
npm start
```

---

## Running Tests

```bash
npm test                 # all tests
npm run test:coverage    # with coverage report (target ≥ 70%)
```

Tests are completely self-contained — no database required. The API integration tests use a lightweight in-memory repository.

---

## API Reference

Base URL: `http://localhost:3000/api`

| Method   | Path                                        | Description                         |
|----------|---------------------------------------------|-------------------------------------|
| `GET`    | `/flags`                                    | List all feature flags               |
| `POST`   | `/flags`                                    | Create a feature flag                |
| `GET`    | `/flags/:name`                              | Get a single flag with its overrides |
| `PATCH`  | `/flags/:name`                              | Update global state or description  |
| `DELETE` | `/flags/:name`                              | Delete a flag and all its overrides |
| `PUT`    | `/flags/:name/overrides`                    | Add or update a user/group/region override |
| `DELETE` | `/flags/:name/overrides/:type/:targetId`    | Remove a specific override          |
| `POST`   | `/flags/:name/evaluate`                     | Evaluate a flag for a given context |

### Example requests

#### Create a flag
```bash
curl -X POST http://localhost:3000/api/flags \
  -H "Content-Type: application/json" \
  -d '{"name": "dark-mode", "description": "Enable dark UI theme", "globalEnabled": false}'
```

#### Enable flag globally
```bash
curl -X PATCH http://localhost:3000/api/flags/dark-mode \
  -H "Content-Type: application/json" \
  -d '{"globalEnabled": true}'
```

#### Add a user override (disable for a specific user)
```bash
curl -X PUT http://localhost:3000/api/flags/dark-mode/overrides \
  -H "Content-Type: application/json" \
  -d '{"type": "user", "targetId": "user-123", "enabled": false}'
```

#### Add a group override (enable for beta testers)
```bash
curl -X PUT http://localhost:3000/api/flags/dark-mode/overrides \
  -H "Content-Type: application/json" \
  -d '{"type": "group", "targetId": "beta-testers", "enabled": true}'
```

#### Add a region override (enable for US East)
```bash
curl -X PUT http://localhost:3000/api/flags/dark-mode/overrides \
  -H "Content-Type: application/json" \
  -d '{"type": "region", "targetId": "us-east-1", "enabled": true}'
```

#### Evaluate for a specific context
```bash
curl -X POST http://localhost:3000/api/flags/dark-mode/evaluate \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123", "groupId": "beta-testers", "region": "us-east-1"}'
```

Response:
```json
{
  "flagName": "dark-mode",
  "enabled": false,
  "reason": "user_override"
}
```

#### Remove a user override
```bash
curl -X DELETE http://localhost:3000/api/flags/dark-mode/overrides/user/user-123
```

#### List all flags
```bash
curl http://localhost:3000/api/flags
```

---

## Override Evaluation Precedence

Overrides are resolved in this order (highest wins):

```
1. User override      ← checked first
2. Group override
3. Region override    ← Phase 2
4. Global default     ← fallback
```

---

## Architecture

```
src/
├── core/                          # Pure domain logic — zero I/O, zero framework
│   ├── errors.ts                  # Domain error types (NotFound, Conflict, Validation)
│   ├── types.ts                   # Shared domain types and interfaces
│   ├── IFeatureFlagRepository.ts  # Repository contract (interface)
│   ├── EvaluationEngine.ts        # Stateless evaluation logic
│   └── FeatureFlagService.ts      # Application service + 30s in-process cache
│
├── infrastructure/                # Database implementation
│   ├── db.ts                      # PostgreSQL connection pool (singleton)
│   ├── migrations.ts              # Schema bootstrap (CREATE TABLE IF NOT EXISTS)
│   └── PostgresFeatureFlagRepository.ts
│
└── api/                           # HTTP layer (Express)
    ├── app.ts                     # App factory (injectable service)
    ├── middleware/errorHandler.ts
    └── routes/flags.ts            # All flag routes + Zod input validation
```

The `core/` package has **no dependencies on Express or PostgreSQL**. It can be driven by a CLI, a gRPC server, or any other transport by swapping the infrastructure and API layers.

---

## Assumptions & Tradeoffs

| Decision | Rationale |
|---|---|
| **Flag names are immutable** | Renaming a flag would silently break any references to it in application code. A future rename could use a soft-delete + redirect pattern. |
| **Single `groupId` per evaluation context** | Kept simple for the time box. Real systems pass an array of groups; the engine would need to check each group for an override. |
| **In-process TTL cache (30 s)** | Avoids a DB round-trip on every feature evaluation request. In a multi-replica deployment this is per-process; Redis would be the next step. |
| **Migrations at startup** | Simple `CREATE TABLE IF NOT EXISTS` on boot. A proper migration tool (Flyway, node-pg-migrate) would be used in production. |
| **No authentication** | Out of scope for this challenge. In production: API keys or JWT middleware on write operations. |
| **Upsert for overrides** | A single `PUT` endpoint handles both create and update — reduces API surface and is idempotent. |

---

## What I'd Do Next

**With another hour:**
- `GET /api/flags/:name/evaluate?userId=&groupId=&region=` convenience GET endpoint  
- Pagination + filtering on the list endpoint  
- Structured logging with `pino`

**With another day:**
- Replace the in-process cache with **Redis** for horizontal scaling  
- Multi-group evaluation (pass `groupIds: string[]` in context)  
- Authentication middleware (API keys stored hashed in DB)  
- Audit log table to track who changed what and when  
- Proper migration runner (e.g. `node-pg-migrate`)  
- Integration test suite against a real Postgres test DB  

---

## Known Limitations

- Flag names cannot be changed after creation  
- Evaluation context accepts only one `userId`, one `groupId`, and one `region` at a time  
- No bulk evaluation endpoint (evaluate multiple flags in a single request)  
- Cache changes may take up to 30 s to propagate across all in-process replicas  

---

## AI Tool Disclosure

**GitHub Copilot** was used during development for syntax completion and code generation assistance. All architecture decisions, domain modelling, test design, and tradeoff choices were made by the author.
