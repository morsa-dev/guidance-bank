import type { DetectableStack } from "../context/types.js";

const GENERAL_DERIVE_GUIDANCE = `## General Analysis Contract

Before generating or updating Memory Bank entries:
- Explore the codebase thoroughly before writing
- Prefer project evidence over assumptions
- Generate project-specific rules, not generic copies
- Deduplicate candidate rules before writing
- Keep one clear formulation per rule

## Rule Quality Gate

Create or keep a rule only when at least one is true:
- The pattern appears repeatedly in the codebase
- The pattern is encoded in configuration or tooling
- The pattern is documented and reflected in project structure
- The pattern is clearly part of the intended architecture

For each candidate rule, decide explicitly:
- keep: clear evidence and practical value
- skip: weak evidence or low value
- [VERIFY: ...]: partial evidence and the decision can affect workflow

Safety constraints:
- Prefer rules that reinforce established project workflow over idealized rewrites
- If a rule may disrupt team workflow and evidence is weak, skip it
- If confidence is low for a high-impact decision, use [VERIFY: ...] or ask the user

## Skills Quality Gate

Generate a skill only when it represents a reusable multi-step workflow with clear project evidence.

Each skill should include:
- When to use
- Prerequisites
- Step-by-step workflow with real project paths
- Do not / anti-patterns when relevant

If you generate a reading/index-oriented skill:
- do not output only a static file list
- include conditional routing logic for common task categories
- keep routing concise and directly actionable

## Testing Rules Gate

Before generating testing rules:
- assess how developed testing actually is in this project
- if testing is minimal, do not force broad coverage rules
- add testing rules only when they match actual project practice or explicit user intent
- prefer realistic incremental guidance over idealized requirements`;

const TYPESCRIPT_DERIVE_GUIDANCE = `## TypeScript Evidence Gate

Apply this only when TypeScript is actually present.

Verify from project evidence:
- tsconfig strictness profile
- alias/import strategy and whether boundaries rely on aliases
- type boundaries between transport, domain, and UI/view models
- async and error typing patterns
- runtime validation boundaries for external input

Promote to rules only when repeated:
- broad any / as any usage without narrowing strategy
- unsafe assertion chains
- non-null assertions across async or API boundaries without safety checks
- inconsistent typing patterns for the same domain entities

Preserve detected strictness and alias strategy. Do not introduce unsafe typing shortcuts as defaults.`;

const NODEJS_DERIVE_GUIDANCE = `## Node.js Backend Guidance

Focus on backend patterns: HTTP/API architecture, services, data access, validation, auth, error handling, jobs, and runtime constraints.

Structure discovery:
- identify backend source roots such as src/, apps/, services/, modules/, server/
- map API/module hierarchy 2-3 levels deep

Pattern extraction:
- entry/bootstrap: initialization order and app wiring
- routing/controllers: handler structure and request/response flow
- services/use-cases: business logic boundaries and dependency flow
- data layer: repository/ORM/query boundaries and transaction patterns
- validation/auth: where validation and permissions are enforced
- error/logging: error normalization and log structure
- async/jobs/events: retry, idempotency, and failure handling
- testing: test location, integration/unit split, mocking style

Config and tooling analysis:
- package.json and lockfile
- runtime/env config
- DB or migration config
- worker/queue config
- eslint/formatting config
- deployment/runtime files

Red flags to turn into rules only if repeated:
- missing or inconsistent input validation
- duplicated business logic in handlers
- direct DB access from handlers when a service/data layer exists
- inconsistent error responses
- logging sensitive data
- missing auth checks on protected paths
- duplicated retry/job logic

Likely rule topics when evidence supports them:
- architecture
- api-handlers
- services
- data-access
- validation-auth
- error-logging
- jobs-workers
- testing
- runtime-deploy

Likely skills when evidence supports them:
- adding-endpoint
- adding-service
- code-review
- common-anti-patterns
- troubleshooting`;

const REACT_DERIVE_GUIDANCE = `## React Guidance

Focus on component architecture, routing, data flow, hooks, forms, styling, testing, and project boundaries.

Structure discovery:
- identify where React source code lives
- map feature/page/module hierarchy 2-3 levels deep

Pattern extraction:
- components: composition style, prop boundaries, container vs presentational patterns
- hooks: placement, side effects, dependency handling
- routing: route modules, lazy loading, wrappers/guards
- state: ownership split between context/store/query/local state
- services/API: data fetching abstractions and mapping
- forms: validation and submit flow
- styling: CSS Modules/SCSS/Tailwind/styled-components usage
- testing: test location, mocking style, critical expectations

Version and feature gate:
- verify React version
- verify runtime mode: SPA, SSR-capable custom setup, or mixed
- verify router approach before generating routing rules
- do not introduce Next.js-specific patterns into a plain React stack

Red flags to elevate only if repeated:
- business logic inside render trees
- duplicated side effects across components
- unstable hook dependencies
- ad-hoc data fetching when a service/query layer exists
- mixed state approaches without clear ownership
- large components with multiple responsibilities

Likely rule topics when evidence supports them:
- architecture
- components
- hooks
- routing
- state-management
- services-data
- forms
- styling
- testing
- error-handling

Likely skills when evidence supports them:
- adding-feature
- adding-service
- code-review
- common-anti-patterns
- troubleshooting`;

const ANGULAR_DERIVE_GUIDANCE = `## Angular Guidance

Focus on components, templates, routing, DI, RxJS/signals, forms, testing, and architecture boundaries.

Structure discovery:
- identify where Angular source code lives
- map feature/module hierarchy 2-3 levels deep

Pattern extraction:
- feature structure: placement of components/services/models/routes
- components: selector naming, inputs/outputs, composition style
- templates: control flow, binding patterns, track strategy
- routing: loadChildren/loadComponent conventions, guards/resolvers
- state: signals, RxJS, store, side-effect boundaries, interop
- services/API: HttpClient usage, mapping, retries, error handling
- forms: initialization, validation style, submit flow
- styling: token usage, naming convention, layout patterns
- performance: change detection and template computation boundaries
- testing: spec structure and helper usage

Version and feature gate:
- verify Angular version
- verify standalone vs NgModule vs mixed architecture
- use signals only when supported by version and real usage
- use template control flow only when supported by version and real usage
- do not force modern Angular migrations without project evidence

Red flags to elevate only if repeated:
- mixed state patterns without clear ownership
- business logic in templates
- manual subscriptions without approved cleanup strategy
- nested subscriptions instead of flattened orchestration
- direct HttpClient usage in components when a service abstraction exists
- browser-only APIs without platform guards in SSR-capable projects
- cross-feature imports that violate established boundaries
- repeated template performance issues

Likely rule topics when evidence supports them:
- architecture
- components
- templates
- routing
- state-management
- state-interop
- services-data
- performance
- forms
- styling
- testing
- error-handling
- ssr-browser-boundaries

Likely skills when evidence supports them:
- adding-feature
- adding-service
- code-review
- common-anti-patterns
- troubleshooting`;

const NEXTJS_DERIVE_GUIDANCE = `## Next.js Guidance

Focus on App/Pages Router structure, server/client boundaries, data fetching, caching, metadata, and route organization.

Before generating rules:
- detect whether the project uses App Router, Pages Router, or mixed mode
- detect SSR/SSG/ISR/data-fetching patterns from real route files
- verify metadata handling and route/layout structure 2-3 levels deep
- do not generate rules that assume router features not present in the codebase

Likely rule topics when evidence supports them:
- architecture
- routing
- data-fetching
- server-client-boundaries
- metadata-seo
- caching
- styling
- testing

Likely skills when evidence supports them:
- adding-route
- adding-feature
- code-review
- troubleshooting`;

const OTHER_DERIVE_GUIDANCE = `## Unknown or Mixed Stack Guidance

When stack confidence is low or mixed:
- keep project evidence as the primary source
- prefer conservative technology-neutral rules
- generate only a minimal high-value bank
- for near-empty projects, 2-4 core skills are usually enough
- avoid framework-specific APIs that are not proven by the repository`;

const RECOMMENDED_OUTPUT_SHAPE = `## Recommended Output Shape

Aim for a right-sized bank, not a minimal placeholder:
- 2-6 focused rule files when project evidence supports them
- 2-5 focused skills when reusable workflows are clearly present
- for small or low-confidence projects, prefer fewer high-value entries over quota-filling

Common high-value starting points when evidence supports them:
- core/general
- architecture
- one stack- or workflow-specific topic
- adding-feature
- adding-service
- code-review
- task-based-reading or troubleshooting`;

export const renderCreateDeriveGuidance = (detectedStacks: readonly DetectableStack[]): string => {
  const sections = [GENERAL_DERIVE_GUIDANCE];

  if (detectedStacks.includes("typescript")) {
    sections.push(TYPESCRIPT_DERIVE_GUIDANCE);
  }

  if (detectedStacks.includes("nextjs")) {
    sections.push(NEXTJS_DERIVE_GUIDANCE);
  } else if (detectedStacks.includes("angular")) {
    sections.push(ANGULAR_DERIVE_GUIDANCE);
  } else if (detectedStacks.includes("react")) {
    sections.push(REACT_DERIVE_GUIDANCE);
  }

  if (detectedStacks.includes("nodejs")) {
    sections.push(NODEJS_DERIVE_GUIDANCE);
  }

  if (sections.length === 1) {
    sections.push(OTHER_DERIVE_GUIDANCE);
  }

  sections.push(RECOMMENDED_OUTPUT_SHAPE);

  return sections.join("\n\n");
};
