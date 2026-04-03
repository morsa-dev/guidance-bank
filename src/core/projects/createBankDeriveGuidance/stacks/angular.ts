export const ANGULAR_DERIVE_GUIDANCE = `## Angular Guidance

Focus on Angular patterns: components, templates, routing, DI, RxJS/signals, forms, testing, and architecture boundaries.

## Codebase Exploration Before Generating

### Structure Discovery

1. List root folders.
2. Identify where Angular source code lives (for example: src/, apps/, libs/, projects/).
3. Map feature/module hierarchy 2-3 levels deep.
4. Record the exact folder names and paths you found.

### Pattern Extraction (Read Real Files)

For each category, read 2-3 representative files and extract reusable decisions:

| Category | What to Find | What to Extract |
|----------|--------------|-----------------|
| Feature structure | Feature folders and boundaries | Placement rules for components/services/models/routes |
| Components | Component model and container/presentational split | Selector naming, inputs/outputs, host bindings |
| Templates | Control flow and binding patterns | @if/@for usage, track strategy, async pipe strategy, event handling |
| Routing | Route configs and lazy loading | loadChildren/loadComponent conventions, guards/resolvers |
| State layer | Signals/RxJS/store/effects | State ownership, side-effect boundaries, update patterns, interop boundaries |
| Services/API | HttpClient and data services | DI conventions, mapping, error handling, retries |
| Forms | Reactive forms and validators | Form initialization, validation style, submit flow |
| Styling | SCSS/CSS organization | Token usage, naming convention, layout patterns |
| Performance | Change detection and template costs | OnPush/default usage, template computation boundaries |
| Testing | Spec structure and helpers | Test location, mocking style, critical test expectations |

### Config and Tooling Analysis (Angular-Specific)

Read these files if present:
- package.json and lockfile
- angular.json / workspace.json / project.json
- eslint config and formatting config
- src/main.ts, app config, bootstrap files
- app.routes.ts and route setup files
- nx.json / turbo.json (if monorepo)
- workspace lint rules for boundaries (for example \`@nx/enforce-module-boundaries\`)
- tailwind config (if present) and shared style token files

### Version and Feature Gate (Angular)

Before turning patterns into rules, verify what is actually used in this codebase:
- Angular version from dependencies and workspace config.
- Component style in real files: standalone, NgModule, or mixed.
- State style in real files: signals, RxJS streams, store/effects, or mixed.
- Use standalone APIs only when version and code evidence support them (Angular 14+ and real standalone usage).
- Use template control flow (\`@if/@for/@switch\`) only when version and code evidence support it (Angular 17+ with real usage/migration evidence).
- Use signals only when version and code evidence support them (Angular 16+ with real imports/usages like \`signal\`, \`computed\`, \`effect\`).
- Use \`takeUntilDestroyed\` for subscription cleanup only when version and code evidence support it (Angular 16+ with \`DestroyRef\`/interop usage); otherwise keep the existing local cleanup pattern.
- If a feature is not supported by version and code evidence, do not generate rules that require it.

### Red Flag Detection (Angular-Specific)

Search for recurring issues that should become explicit rules:
- TODO/FIXME/HACK patterns
- mixed state patterns without clear ownership
- mixed usage of \`inject()\` and constructor DI without a clear project convention
- business logic in templates instead of component/service layer
- \`@for\` loops without stable tracking strategy when control flow syntax is used
- ad-hoc dependency creation instead of DI
- manual subscriptions without the project-approved cleanup strategy (\`takeUntilDestroyed\` when supported, otherwise local equivalent)
- nested subscriptions instead of flattened stream composition (\`switchMap\`/\`concatMap\`/\`exhaustMap\` or local effect/store patterns)
- duplicated state sources across signals and observables without explicit ownership boundaries
- duplicated API mapping logic
- direct HttpClient usage in templates/components when a service abstraction exists
- browser-only APIs (\`window\`, \`document\`, \`localStorage\`) used without platform guards in SSR-capable projects
- DOM side effects inside constructors instead of lifecycle/hooks with platform checks
- large shared modules with unclear responsibility
- cross-feature imports that violate established boundaries
- hardcoded design values where project tokens/variables are the standard
- expensive template-bound computations or repeated function calls in hot render paths
- inconsistent API error contract across handlers/services/interceptors/UI layer
- error handling and notification behavior duplicated across features
- side effects in \`computed\`/\`effect\` without clear boundaries and intent

### Analysis Checklist (Angular Project)

Document these with file path evidence:

- Architecture and boundary model.
- Component and template model.
- Routing and lazy-loading strategy.
- State and async model (ownership, subscriptions, interop).
- Service/API model and error-contract boundaries.
- SSR/hydration and browser-only API handling strategy (if SSR-capable).
- Change detection and template performance patterns.
- Styling mode and design-token strategy.
- Testing strategy and depth by module type.
- Main recurring anti-patterns and where they appear.

Before final output, gather concrete evidence for each applicable item.
If evidence remains partial, continue conservatively and mark uncertainty with \`[VERIFY: ...]\` instead of blocking output.

### Generation Locks (Prevent Architecture Drift)

Apply these constraints when generating rules and skills:
- Preserve detected architecture and import/workspace boundaries.
- Preserve component/template interaction model (including stable loop tracking when \`@for\` is used).
- Preserve state ownership and async boundaries (subscriptions, interop, side effects).
- Preserve routing loading strategy.
- Preserve SSR/browser safety boundaries in SSR-capable projects.
- Preserve styling system and token conventions.
- Avoid high-impact workflow changes unless strongly supported by project evidence.

## Skill Candidates (Angular)

Generate these skills with actual project paths and Angular-specific workflow steps:
Generate only skills that have clear project evidence and practical value.
For small/low-confidence projects, 2-4 core skills are usually enough.

### adding-feature
- Include actual feature folder structure used in this project.
- Show how to add component/service/route wiring using existing local patterns.
- Include integration with state layer and tests where applicable.

### adding-service
- Include service and API client structure used in this project.
- Show DI pattern, request/response mapping, and error handling.
- Include mocking/test strategy for service behavior.

### code-review
- Include Angular-specific review checklist based on project patterns.
- Cover template complexity, state ownership, subscription safety, and route boundaries.

### common-anti-patterns
- Include recurring Angular anti-patterns from this project.
- Pair each anti-pattern with preferred local alternative.

### troubleshooting
- Include common Angular build/runtime/test issues for this codebase.
- Include where to inspect first when these issues happen.

### [framework-specific]
Generate 1-3 extra skills based on actual stack usage:
- signals-patterns (if signals are primary)
- rxjs-patterns (if RxJS orchestration is primary)
- ngrx-patterns (if NgRx is present)
- forms-patterns (if complex forms are central)
- monorepo-workflows (if apps/libs pattern exists)

### enrichment-tasks (optional)
- Generate this only when the user explicitly asks for enrichment, or when analysis shows a clear gap in the existing rule/skill bank.

## Rule Generation Requirements

### What NOT to Include

- Do not invent generic philosophy ("clean code", "think about user").
- Do not duplicate what linters/formatters fully enforce.
- Do not add rules without evidence from codebase patterns.
- Do not repeat the same rule across multiple rule topics.
- Do not propose Angular APIs that are incompatible with detected project version and architecture mode.
- Do not force Angular workflow-changing migrations unless they are already reflected in project direction and evidence.

### Rule Content Requirements

Keep this section Angular-specific:
- Capture decisions tied to Angular architecture, templates, routing, state, and DI boundaries.
- Prefer Angular-native patterns and terminology over generic cross-stack wording.
- Highlight recurring Angular anti-patterns and safer local alternatives.
- Include interaction, lifecycle, subscription, and performance constraints only when supported by project evidence.
- Keep rules compatible with current Angular workflow unless stronger project evidence justifies change.

## Algorithm: Analysis -> Rules (Angular)

Follow this systematic approach for Angular projects:

**Structure -> Architecture Rules:**
1. Identify repeated folder/module structures across features.
2. Define placement rules for components, services, models, and routes.
3. Document cross-feature boundaries and allowed dependencies.

**Components/Templates -> UI Rules:**
1. Scan representative component and template files.
2. Extract repeated patterns for bindings, control flow, and composition.
3. Convert repeated high-quality patterns into concise rules.

**State/Async -> Data Flow Rules:**
1. Identify how state is owned and updated (signals/RxJS/store).
2. Identify where side effects live and how async errors are handled.
3. Identify subscription orchestration and signals/observables interop boundaries.
4. Generate rules that keep ownership, side effects, and interop boundaries explicit.

**Configs -> Architectural Constraints:**
1. Inspect Angular/workspace/eslint settings.
2. Promote only meaningful architectural constraints (aliases, boundaries, layering).
3. Avoid restating trivial formatter/linter-only behavior.

**Performance -> Change Detection and Template Rules:**
1. Identify dominant change detection strategy (OnPush/default) by module type.
2. Detect repeated template performance issues (heavy bindings, repeated function calls, unstable loops).
3. Generate concise rules that improve performance without forcing architectural rewrites.

**Red Flags -> Safety Rules:**
1. If the same anti-pattern appears repeatedly, define "Avoid X, do Y instead".
2. Tie alternatives to existing utilities/patterns used in this codebase.

**Tests -> Testing Rules:**
1. Identify where tests live and which module types are covered.
2. Extract common spec patterns, helper usage, and minimal expected coverage.
3. Require tests for module types that are consistently tested in this project.

## Recommended Rule Topics (Angular Project)

Split by topic:
Generate only topics that are supported by concrete project evidence.

| Topic | Covers (Angular-Specific) |
|------|----------------------------|
| \`architecture\` | feature boundaries, module placement, dependency direction |
| \`components\` | standalone patterns, selector/file naming, composition |
| \`templates\` | binding rules, control flow style, template complexity limits |
| \`routing\` | lazy loading, guards/resolvers, route organization |
| \`state-management\` | signals/RxJS/store ownership and side-effect boundaries |
| \`state-interop\` | signals/observables bridge boundaries and ownership consistency |
| \`services-data\` | API services, mapping, interceptors, error handling |
| \`performance\` | change detection usage, template performance boundaries |
| \`forms\` | reactive forms architecture, validation and submit flow |
| \`styling\` | SCSS/CSS structure, token usage, naming convention |
| \`testing\` | spec placement, test helpers, minimum critical checks |
| \`error-handling\` | error mapping, user messages, retry/logging boundaries |
| \`ssr-browser-boundaries\` | browser-only API guards and platform-safe behavior in SSR-capable projects |
| \`i18n\` | localization key usage and string handling (if applicable) |

## Context-to-Rule/Skill Mapping (Angular)

Use this mapping to decide what files to generate:
Generate only skills that are supported by concrete project evidence.

| Found in Angular Codebase | Generate Rule Topic | Generate Skill |
|--------------------------|---------------------|----------------|
| Standalone component pattern | \`components\`, \`templates\` | \`adding-feature\` |
| NgModule-heavy feature setup | \`architecture\`, \`components\` | \`adding-feature\` |
| Nx workspace with boundary rules | \`architecture\` | \`monorepo-workflows\` |
| Signals-based state | \`state-management\` | \`signals-patterns\` |
| RxJS stream orchestration | \`state-management\` | \`rxjs-patterns\` |
| NgRx store/effects | \`state-management\` | \`ngrx-patterns\` |
| Signals/RxJS interop boundaries | \`state-interop\`, \`state-management\` | \`code-review\` |
| Structured API services | \`services-data\` | \`adding-service\` |
| Complex reactive forms | \`forms\` | \`forms-patterns\` |
| OnPush-dominant components | \`components\`, \`templates\` | \`code-review\` |
| Repeated template performance issues | \`performance\`, \`templates\` | \`troubleshooting\` |
| Tailwind utility-first styling | \`styling\` | \`code-review\` |
| BEM-dominant styling conventions | \`styling\` | \`code-review\` |
| Route guards/resolvers usage | \`routing\` | \`code-review\` |
| SSR/browser platform guards | \`ssr-browser-boundaries\` | \`troubleshooting\` |
| Repeated runtime/build issues | \`error-handling\` | \`troubleshooting\` |
| Repeated unsafe patterns | \`error-handling\` | \`common-anti-patterns\` |
`;
