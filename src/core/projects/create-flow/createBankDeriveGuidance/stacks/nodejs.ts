export const NODEJS_DERIVE_GUIDANCE = `## Node.js Backend Guidance

Focus on Node.js backend patterns: HTTP/API architecture, service and data layers, validation, auth, error handling, background processing, and runtime/ops boundaries.
Apply TypeScript guidance from the shared section only when the project uses TypeScript.

## Codebase Exploration Before Generating

### Structure Discovery

1. List root folders.
2. Identify backend source roots (for example: \`src/\`, \`apps/\`, \`services/\`, \`modules/\`, \`server/\`).
3. Map API/module hierarchy 2-3 levels deep.
4. Record exact folder names and paths.

### Runtime and Framework Detection (Critical)

Determine what backend style is actually used:
- Express / Fastify / NestJS / Koa / custom HTTP server
- Monolith service vs modular services
- REST / RPC / GraphQL / mixed
- ESM / CJS runtime mode (if relevant)

Do not generate framework-specific rules until runtime/framework mode is explicit with file-path evidence.

### Pattern Extraction (Read Real Files)

For each category, read 2-3 representative files and extract reusable decisions:

| Category | What to Find | What to Extract |
|----------|--------------|-----------------|
| Entry/bootstrap | server startup and app wiring | initialization order, middleware setup, module loading |
| Routing/controllers | endpoint modules and handlers | handler structure, request/response flow, route organization |
| Services/use-cases | business logic orchestration | service boundaries, dependency flow, transaction patterns |
| Data layer | ORM/query/repository usage | data access boundaries, mapping, consistency rules |
| Validation | request/input validation | schema location, validation timing, error shape |
| Auth/security | auth guards/middleware | token/session flow, permission checks, sensitive-path handling |
| Error handling/logging | global handlers and logger usage | error normalization, log structure, observability patterns |
| Async/jobs/events | queues, workers, schedulers | job boundaries, retry/error handling, idempotency patterns |
| Testing | test setup and suite structure | test location, integration/unit split, mocking style |

### Config and Tooling Analysis (Node.js-Specific)

Read these files if present:
- package.json and lockfile
- runtime config and env files (\`.env.example\`, config modules, secrets loading)
- framework config (Nest config, Fastify plugins, Express wiring, GraphQL config, etc.)
- DB/migration config (Prisma/TypeORM/Knex/Sequelize or equivalent)
- queue/worker config (BullMQ, agenda, cron jobs, message consumers)
- eslint and formatting config
- deployment/runtime files (Dockerfile, compose, process manager config, CI scripts)
- monorepo config (\`nx.json\`, \`turbo.json\`, workspace manifests)

### Version and Feature Gate (Node.js)

Before turning patterns into rules, verify what is actually used in this codebase:
- Node.js version and module/runtime mode.
- Backend framework mode and routing style.
- Data layer style (ORM/query builder/raw SQL/repository wrappers).
- Validation strategy and where it is enforced.
- Auth strategy and boundary points.
- Background processing model (queues/workers/schedulers), if present.
- Do not introduce framework conventions not present in the project.

### Red Flag Detection (Node.js-Specific)

Search for recurring issues that should become explicit rules:
- missing or inconsistent request validation on public endpoints
- duplicated business logic between handlers/controllers
- direct DB access from handlers when service/repository layer exists
- inconsistent error responses across similar endpoints
- logging sensitive fields or credentials
- missing auth/permission checks on protected routes
- long synchronous/blocking operations in request path
- inconsistent transaction boundaries or partial failure handling
- duplicated job/retry logic across workers

### Analysis Checklist (Node.js Project)

Document these with file path evidence:

- Framework/runtime model and module organization.
- Routing/controller conventions.
- Service/data-layer boundaries and mapping style.
- Validation and auth flow.
- Error/logging standards.
- Async/jobs/events architecture (if present).
- Testing strategy and helper usage.
- Deployment/runtime constraints.
- Main recurring anti-patterns and where they appear.

Before final output, gather concrete evidence for each applicable item.
If evidence remains partial, continue conservatively and mark uncertainty with \`[VERIFY: ...]\` instead of blocking output.

### Generation Locks (Prevent Architecture Drift)

Apply these constraints when generating rules and skills:
- Preserve detected framework/runtime mode; do not migrate architecture implicitly.
- Preserve routing style and handler layering.
- Preserve service/data boundaries and transaction model.
- Preserve validation/auth/error contracts already used across endpoints.
- Preserve async/job processing model when present.
- Preserve deployment/runtime assumptions and monorepo boundaries when present.

## Skill Candidates (Node.js)

Generate these skills with actual project paths and Node.js-specific workflow steps:
Generate only skills that have clear project evidence and practical value.
For small/low-confidence projects, 2-4 core skills are usually enough.

### adding-endpoint
- Include actual route/controller/handler structure from this project.
- Show validation, auth checks, service call, and response pattern based on local conventions.
- Include verification or tests according to existing practices.

### adding-service
- Include actual service and data access structure used in this project.
- Show dependency wiring, transaction/error handling, and integration points.
- Include test/mocking strategy used for services in this codebase.

### code-review
- Include Node.js backend review checklist based on project patterns.
- Cover validation, auth boundaries, error contracts, data layer boundaries, and logging hygiene.

### common-anti-patterns
- Include recurring backend anti-patterns from this project.
- Pair each anti-pattern with preferred local alternative.

### troubleshooting
- Include common runtime/data/integration issues for this codebase.
- Include where to inspect first when these issues happen.

### [framework-specific]
Generate 1-3 extra skills based on actual stack usage:
- nestjs-patterns (if NestJS is primary)
- express-fastify-patterns (if Express/Fastify style is primary)
- data-access-patterns (if ORM/repository complexity is central)
- jobs-workers-patterns (if queues/workers are central)
- monorepo-workflows (if apps/libs pattern exists)

### enrichment-tasks (optional)
- Generate this only when the user explicitly asks for enrichment, or when analysis shows a clear gap in the existing rule/skill bank.

## Rule Generation Requirements

### What NOT to Include

- Do not invent generic philosophy ("clean code", "think about user").
- Do not duplicate what linters/formatters fully enforce.
- Do not add rules without evidence from codebase patterns.
- Do not repeat the same rule across multiple rule topics.
- Do not introduce framework APIs or architectural layers not used in this backend.

### Rule Content Requirements

Keep this section Node.js-backend-specific:
- Capture decisions tied to request flow, service/data boundaries, validation/auth, and error/logging contracts.
- Use runtime/framework terminology aligned with observed project structure.
- Highlight recurring backend anti-patterns and safer local alternatives.

## Algorithm: Analysis -> Rules (Node.js)

Follow this systematic approach for Node.js backends:

**Structure -> Architecture Rules:**
1. Identify repeated module and request-flow structures.
2. Define placement rules for handlers/controllers, services, and data modules.
3. Document allowed dependency directions.

**Request Flow -> API Rules:**
1. Scan representative route/controller/handler files.
2. Extract repeated patterns for validation, auth, response shape, and error mapping.
3. Convert repeated high-quality patterns into concise rules.

**Service/Data -> Boundary Rules:**
1. Identify service orchestration and data access boundaries.
2. Extract transaction and error-handling conventions.
3. Generate rules preserving those boundaries.

**Async/Jobs -> Reliability Rules:**
1. Inspect workers/queues/schedulers where present.
2. Extract retry/idempotency and failure-handling patterns.
3. Generate rules for reliable async processing.

**Configs -> Runtime Constraints:**
1. Inspect runtime/framework/deployment config files.
2. Promote only meaningful architectural constraints.
3. Avoid restating trivial formatter/linter-only behavior.

## Recommended Rule Topics (Node.js Project)

Split by topic:
Generate only topics supported by concrete project evidence.

| Topic | Covers (Node.js-Specific) |
|------|----------------------------|
| \`architecture\` | module boundaries, placement, dependency direction |
| \`api-handlers\` | route/controller/handler organization and request flow |
| \`services\` | business logic boundaries and orchestration patterns |
| \`data-access\` | repositories/ORM/query layer patterns and transaction boundaries |
| \`validation-auth\` | input validation and permission/auth boundaries |
| \`error-logging\` | error normalization, logging patterns, observability boundaries |
| \`jobs-workers\` | queue/worker/scheduler behavior and retry/idempotency |
| \`testing\` | test placement, helper usage, minimum critical checks |
| \`runtime-deploy\` | runtime assumptions, env/config boundaries, deployment constraints |

## Context-to-Rule/Skill Mapping (Node.js)

Use this mapping to decide what files to generate:
Generate only skills that are supported by concrete project evidence.

| Found in Node.js Codebase | Generate Rule Topic | Generate Skill |
|---------------------------|---------------------|----------------|
| Clear handler -> service -> repository flow | \`api-handlers\`, \`services\`, \`data-access\` | \`adding-endpoint\`, \`adding-service\` |
| Strong validation/auth middleware usage | \`validation-auth\` | \`code-review\` |
| Centralized error mapper/logger | \`error-logging\` | \`troubleshooting\` |
| Worker/queue architecture | \`jobs-workers\` | \`jobs-workers-patterns\` |
| NestJS module/controller/provider patterns | \`architecture\`, \`api-handlers\` | \`nestjs-patterns\` |
| Express/Fastify route plugins and handlers | \`api-handlers\`, \`architecture\` | \`express-fastify-patterns\` |
| Monorepo boundary rules | \`architecture\`, \`runtime-deploy\` | \`monorepo-workflows\` |
| Repeated unsafe patterns | \`error-logging\` | \`common-anti-patterns\` |
`;
