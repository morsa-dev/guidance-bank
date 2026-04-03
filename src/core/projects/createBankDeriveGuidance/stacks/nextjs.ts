export const NEXTJS_DERIVE_GUIDANCE = `## Next.js Guidance

Focus on Next.js-specific patterns: router mode, server/client boundaries, data fetching and caching strategy, route handlers, middleware, metadata, and runtime constraints.
Apply React component/hook conventions from observed project patterns where relevant.

## Codebase Exploration Before Generating

### Structure Discovery

1. List root folders.
2. Identify Next.js source roots (\`app/\`, \`pages/\`, \`src/app/\`, \`src/pages/\`, \`components/\`, \`lib/\`).
3. Detect route/layout structure 2-3 levels deep.
4. Record the exact folder names and paths you found.

### Router Mode Detection (Critical)

Determine which routing model is actually used:
- App Router (\`app/\`, route segments, \`layout.tsx\`, \`page.tsx\`, \`route.ts\`)
- Pages Router (\`pages/\`, \`_app.tsx\`, \`_document.tsx\`, \`pages/api\`)
- Mixed migration state

Do not generate rules until router mode is explicit with file-path evidence.

### Pattern Extraction (Read Real Files)

For each category, read 2-3 representative files and extract reusable decisions:

| Category | What to Find | What to Extract |
|----------|--------------|-----------------|
| Routing/Layout | Route segments and layouts | Route organization, segment conventions, nesting boundaries |
| Server/Client split | \`use client\`, server components, client hooks | Boundary rules for where logic can run |
| Data fetching/cache | \`fetch\`, cache/revalidate usage | Caching model, revalidation strategy, dynamic/static behavior |
| API layer | \`route.ts\` or \`pages/api\` handlers | Request/response structure, auth/error handling, service usage |
| Actions/mutations | Server actions/forms/mutations | Mutation flow and boundaries |
| Middleware/Auth | \`middleware.ts\`, auth wrappers | Access control flow, redirect patterns, edge/runtime constraints |
| Metadata/SEO | metadata exports and head patterns | Canonical metadata structure and ownership |
| Styling/UI | CSS Modules/Tailwind/SCSS/design tokens | Styling conventions and composition patterns |
| Testing | test setup and specs | Test location, mocking strategy, critical coverage expectations |

### Config and Tooling Analysis (Next.js-Specific)

Read these files if present:
- package.json and lockfile
- \`next.config.js\` / \`next.config.mjs\` / \`next.config.ts\`
- \`middleware.ts\`
- \`app/layout.tsx\`, \`app/page.tsx\`, nested segment files
- \`pages/_app.tsx\`, \`pages/_document.tsx\`, \`pages/api/**\` (if Pages Router)
- eslint config and formatting config
- deployment/runtime config (edge/node settings if present)
- monorepo config (\`nx.json\`, \`turbo.json\`, workspace manifests)

### Version and Feature Gate (Next.js)

Before turning patterns into rules, verify what is actually used in this codebase:
- Next.js version from dependencies.
- Router mode: App Router, Pages Router, or mixed.
- Runtime target per area: Node.js runtime, Edge runtime, or mixed.
- Use Server Actions only when App Router usage and code evidence support them.
- Use \`route.ts\` handler conventions only when App Router API routes are present.
- Use \`pages/api\` conventions only when Pages Router API routes are present.
- Preserve observed caching model (\`revalidate\`, dynamic/static behavior, cache tags) instead of introducing new defaults.

### Red Flag Detection (Next.js-Specific)

Search for recurring issues that should become explicit rules:
- mixed App Router and Pages Router patterns without clear boundaries
- server/client boundary violations (client hooks in server components, server-only logic in client components)
- inconsistent caching/revalidation strategy across similar routes
- duplicated request/response logic across route handlers and services
- heavy business logic in middleware
- direct secret/runtime-dependent usage in client-side code
- inconsistent error/not-found/redirect handling across route modules

### Analysis Checklist (Next.js Project)

Document these with file path evidence:

- Router mode and route organization model.
- Server/client component boundaries.
- Data fetching and caching/revalidation strategy.
- API route pattern and service integration.
- Middleware/auth flow and runtime boundaries.
- Metadata/SEO pattern and ownership.
- Testing strategy and helper usage.
- Styling mode and constraints.
- Main recurring anti-patterns and where they appear.

Before final output, gather concrete evidence for each applicable item.
If evidence remains partial, continue conservatively and mark uncertainty with \`[VERIFY: ...]\` instead of blocking output.

### Generation Locks (Prevent Architecture Drift)

Apply these constraints when generating rules and skills:
- Preserve detected router mode (App Router / Pages Router / mixed); do not migrate architecture implicitly.
- Preserve server/client split boundaries; do not move logic across boundaries without evidence.
- Preserve detected runtime targets and deployment assumptions (Node/Edge).
- Preserve detected data fetching and caching model; avoid introducing incompatible defaults.
- Preserve detected styling mode and monorepo boundaries when present.

## Skill Candidates (Next.js)

Generate these skills with actual project paths and Next.js-specific workflow steps:
Generate only skills that have clear project evidence and practical value.
For small/low-confidence projects, 2-4 core skills are usually enough.

### adding-route
- Include actual route segment or pages structure from this project.
- Show how to add page/layout/route wiring using existing conventions.
- Include data-loading and error/not-found handling integration where applicable.

### adding-api-route
- Include existing API route style (\`app/**/route.ts\` or \`pages/api/**\`).
- Show request parsing, validation, service usage, and error response flow.
- Include test or verification strategy used in this project.

### code-review
- Include Next.js-specific review checklist based on project patterns.
- Cover router mode consistency, server/client boundaries, caching strategy, and runtime correctness.

### common-anti-patterns
- Include recurring Next.js anti-patterns from this project.
- Pair each anti-pattern with preferred local alternative.

### troubleshooting
- Include common build/runtime/hydration/cache issues for this codebase.
- Include where to inspect first when these issues happen.

### [framework-specific]
Generate 1-3 extra skills based on actual stack usage:
- app-router-patterns (if App Router is primary)
- pages-router-patterns (if Pages Router is primary)
- server-actions-patterns (if Server Actions are primary)
- middleware-auth-workflows (if middleware/auth is central)
- monorepo-workflows (if apps/libs pattern exists)

### enrichment-tasks (optional)
- Generate this only when the user explicitly asks for enrichment, or when analysis shows a clear gap in the existing rule/skill bank.

## Rule Generation Requirements

### What NOT to Include

- Do not invent generic philosophy ("clean code", "think about user").
- Do not duplicate what linters/formatters fully enforce.
- Do not add rules without evidence from codebase patterns.
- Do not repeat the same rule across multiple rule topics.
- Do not mix App Router and Pages Router conventions unless mixed mode is confirmed in this project.

### Rule Content Requirements

Keep this section Next.js-specific:
- Capture decisions tied to router mode, server/client boundaries, caching strategy, API layer, and runtime model.
- Use Next.js-native terminology aligned with observed project structure.
- Highlight recurring Next.js anti-patterns and safer local alternatives.

## Algorithm: Analysis -> Rules (Next.js)

Follow this systematic approach for Next.js projects:

**Router Structure -> Architecture Rules:**
1. Determine router mode and segment organization.
2. Define placement rules for pages/layouts/route handlers.
3. Document allowed dependency directions between route modules and shared layers.

**Server/Client Boundaries -> Runtime Rules:**
1. Identify where server and client logic currently lives.
2. Extract repeated boundary decisions for hooks, secrets, and side effects.
3. Generate concise rules preserving those boundaries.

**Data/API -> Flow Rules:**
1. Identify fetching, caching, mutation, and API response patterns.
2. Extract repeated error handling and validation conventions.
3. Generate rules that keep data flow predictable across routes.

**Configs -> Constraints Rules:**
1. Inspect Next config, middleware, runtime/deployment settings.
2. Promote only meaningful architectural constraints.
3. Avoid restating trivial formatter/linter-only behavior.

**Tests -> Testing Rules:**
1. Identify where tests live and which module types are covered.
2. Extract common test patterns and helper usage.
3. Require tests for module types that are consistently tested in this project.

## Recommended Rule Topics (Next.js Project)

Split by topic:
Generate only topics that are supported by concrete project evidence.

| Topic | Covers (Next.js-Specific) |
|------|----------------------------|
| \`architecture\` | route/module boundaries, placement, dependency direction |
| \`routing\` | App Router/Pages Router conventions, segments/pages/layouts |
| \`server-client-boundaries\` | server vs client component boundaries and constraints |
| \`data-fetching-cache\` | fetching model, cache/revalidate strategy, dynamic/static behavior |
| \`api-routes\` | route handlers or pages/api conventions, request/response patterns |
| \`middleware-auth\` | middleware flow, access control, redirects/runtime constraints |
| \`components\` | UI composition patterns and file organization |
| \`styling\` | CSS strategy, token usage, naming conventions |
| \`testing\` | test placement, helpers, minimum critical checks |
| \`error-handling\` | error mapping, not-found/redirect behavior, retry/logging boundaries |
| \`i18n\` | localization key usage and routing integration (if applicable) |

## Context-to-Rule/Skill Mapping (Next.js)

Use this mapping to decide what files to generate:
Generate only skills that are supported by concrete project evidence.

| Found in Next.js Codebase | Generate Rule Topic | Generate Skill |
|---------------------------|---------------------|----------------|
| App Router segments/layouts | \`routing\`, \`architecture\` | \`adding-route\`, \`app-router-patterns\` |
| Pages Router structure | \`routing\`, \`architecture\` | \`adding-route\`, \`pages-router-patterns\` |
| Server/client boundary conventions | \`server-client-boundaries\` | \`code-review\` |
| Structured fetch/cache/revalidate usage | \`data-fetching-cache\` | \`troubleshooting\` |
| API route layer with shared services | \`api-routes\`, \`services-data\` | \`adding-api-route\` |
| Middleware-driven auth/routing | \`middleware-auth\` | \`middleware-auth-workflows\` |
| Monorepo boundary rules | \`architecture\` | \`monorepo-workflows\` |
| Repeated runtime/hydration/cache issues | \`error-handling\` | \`troubleshooting\` |
| Repeated unsafe patterns | \`error-handling\` | \`common-anti-patterns\` |
`;
