export const REACT_DERIVE_GUIDANCE = `## React Guidance

Focus on React patterns: component architecture, routing, data flow, hooks, forms, styling, testing, and project boundaries.

## Codebase Exploration Before Generating

### Structure Discovery

1. List root folders.
2. Identify where React source code lives (for example: src/, app/, packages/, apps/, libs/).
3. Map feature/page/module hierarchy 2-3 levels deep.
4. Record the exact folder names and paths you found.

### Pattern Extraction (Read Real Files)

For each category, read 2-3 representative files and extract reusable decisions:

| Category | What to Find | What to Extract |
|----------|--------------|-----------------|
| App structure | Feature/page/module layout | Placement rules for components/hooks/services/routes |
| Components | Container/presentational split and composition style | Naming, props design, composition boundaries |
| Hooks | Custom hooks and shared logic | Hook placement, dependency handling, side-effect boundaries |
| Routing | Router setup and route modules | Route organization, lazy loading, guards/wrappers patterns |
| State layer | Context/store/query state | State ownership and update boundaries |
| Services/API | Data access layer and clients | Fetching abstraction, mapping, retries/error handling |
| Forms | Form libs or native patterns | Validation flow, submit handling, reusable form logic |
| Styling | CSS Modules/SCSS/Tailwind/styled-components | Styling conventions and token usage |
| Testing | Test setup and specs | Test location, mocking style, critical test expectations |

### Config and Tooling Analysis (React-Specific)

Read these files if present:
- package.json and lockfile
- router entry and route config files
- build config (Vite/Webpack/CRA/RSBuild/etc.)
- eslint config and formatting config
- test config (Vitest/Jest/RTL/Cypress/Playwright)
- monorepo config (\`nx.json\`, \`turbo.json\`, workspace manifests)
- style config (Tailwind/PostCSS/style token files)

### Version and Feature Gate (React)

Before turning patterns into rules, verify what is actually used in this codebase:
- React version from dependencies.
- Runtime mode: client-only SPA, SSR-enabled custom setup, or mixed.
- Router approach: React Router / file-based / custom / none.
- Use Suspense/lazy boundaries only when version and code evidence support them.
- Use React Router data APIs only when they are present in actual route definitions.
- Do not introduce Next.js-specific patterns (\`app/\` router conventions, server actions, \`next/*\` APIs) in this stack.

### Red Flag Detection (React-Specific)

Search for recurring issues that should become explicit rules:
- TODO/FIXME/HACK patterns
- business logic inside JSX render trees instead of hooks/services
- duplicated side effects across components
- unstable dependencies in \`useEffect\` / \`useMemo\` / \`useCallback\`
- ad-hoc data fetching inside many components when a service/query layer exists
- inconsistent error/loading handling across similar screens
- mixed state approaches without clear ownership boundaries
- overuse of prop drilling where local project patterns use context/store
- large component files with multiple responsibilities

### Analysis Checklist (React Project)

Document these with file path evidence:

- Architecture style and feature boundaries.
- Component composition style and reusability boundaries.
- Routing approach and lazy loading strategy.
- State management approach (context/store/query/local state split).
- Data access and API mapping style.
- Form strategy and validation patterns.
- Testing strategy and helper usage.
- Styling mode and constraints.
- Main recurring anti-patterns and where they appear.

Before final output, gather concrete evidence for each applicable item.
If evidence remains partial, continue conservatively and mark uncertainty with \`[VERIFY: ...]\` instead of blocking output.

### Generation Locks (Prevent Architecture Drift)

Apply these constraints when generating rules and skills:
- Preserve detected runtime mode (SPA/SSR/mixed) and avoid cross-mode assumptions.
- Preserve detected router mode and loading strategy; do not switch routing architecture without project evidence.
- Preserve detected state ownership model and avoid mixing patterns unless intentionally present.
- Preserve detected styling mode; do not introduce a new styling system without explicit user request.
- If monorepo boundaries are present, keep established workspace structure and dependency direction.

## Skill Candidates (React)

Generate these skills with actual project paths and React-specific workflow steps:
Generate only skills that have clear project evidence and practical value.
For small/low-confidence projects, 2-4 core skills are usually enough.

### adding-feature
- Include actual feature/page/module structure used in this project.
- Show component, hook, route, and integration steps using existing local patterns.
- Include state/data wiring and tests where applicable.

### adding-service
- Include service/data client structure used in this project.
- Show request/response mapping and error handling flow.
- Include mocking/test strategy for service behavior.

### code-review
- Include React-specific review checklist based on project patterns.
- Cover render complexity, hook correctness, state ownership, and route boundaries.

### common-anti-patterns
- Include recurring React anti-patterns from this project.
- Pair each anti-pattern with preferred local alternative.

### troubleshooting
- Include common build/runtime/test issues for this codebase.
- Include where to inspect first when these issues happen.

### [framework-specific]
Generate 1-3 extra skills based on actual stack usage:
- router-patterns (if routing complexity is central)
- state-patterns (if Redux/Zustand/Context architecture is central)
- query-patterns (if TanStack Query or equivalent is central)
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
- Do not propose framework-specific APIs not used in this stack.

### Rule Content Requirements

Keep this section React-specific:
- Capture decisions tied to component composition, hooks, routing, state boundaries, and data layer.
- Prefer project-native React terminology over generic cross-stack wording.
- Highlight recurring React anti-patterns and safer local alternatives.

## Algorithm: Analysis -> Rules (React)

Follow this systematic approach for React projects:

**Structure -> Architecture Rules:**
1. Identify repeated folder/module structures across features/pages.
2. Define placement rules for components, hooks, services, and route modules.
3. Document boundaries and allowed dependency directions.

**Components/Hooks -> UI Rules:**
1. Scan representative component and hook files.
2. Extract repeated patterns for composition, props, hook responsibilities, and side effects.
3. Convert repeated high-quality patterns into concise rules.

**State/Async -> Data Flow Rules:**
1. Identify where state is owned and how async updates are coordinated.
2. Identify where side effects and error handling live.
3. Generate rules that keep ownership and side-effect boundaries explicit.

**Configs -> Architectural Constraints:**
1. Inspect router/build/eslint/test settings.
2. Promote only meaningful architectural constraints (aliases, boundaries, layering).
3. Avoid restating trivial formatter/linter-only behavior.

**Red Flags -> Safety Rules:**
1. If the same anti-pattern appears repeatedly, define "Avoid X, do Y instead".
2. Tie alternatives to existing utilities/patterns used in this codebase.

**Tests -> Testing Rules:**
1. Identify where tests live and which module types are covered.
2. Extract common test patterns and helper usage.
3. Require tests for module types that are consistently tested in this project.

## Recommended Rule Topics (React Project)

Split by topic:
Generate only topics that are supported by concrete project evidence.

| Topic | Covers (React-Specific) |
|------|--------------------------|
| \`architecture\` | feature/module boundaries, placement, dependency direction |
| \`components\` | composition style, props boundaries, reusable UI patterns |
| \`hooks\` | custom hooks, side-effect boundaries, dependency handling |
| \`routing\` | route organization, lazy loading, wrappers/guards |
| \`state-management\` | context/store/query ownership and update boundaries |
| \`services-data\` | API services, mapping, retries/error handling |
| \`forms\` | form architecture, validation and submit flow |
| \`styling\` | CSS strategy, token usage, naming conventions |
| \`testing\` | test placement, helpers, minimum critical checks |
| \`error-handling\` | error mapping, user-facing behavior, retry/logging boundaries |
| \`i18n\` | localization key usage and string handling (if applicable) |

## Context-to-Rule/Skill Mapping (React)

Use this mapping to decide what files to generate:
Generate only skills that are supported by concrete project evidence.

| Found in React Codebase | Generate Rule Topic | Generate Skill |
|-------------------------|---------------------|----------------|
| Feature-module based structure | \`architecture\`, \`components\` | \`adding-feature\` |
| Router-centric app flow | \`routing\` | \`router-patterns\` |
| Context/store ownership patterns | \`state-management\` | \`state-patterns\` |
| Query-layer orchestration | \`services-data\`, \`state-management\` | \`query-patterns\` |
| Structured API service layer | \`services-data\` | \`adding-service\` |
| Complex forms | \`forms\` | \`forms-patterns\` |
| Monorepo boundary rules | \`architecture\` | \`monorepo-workflows\` |
| Repeated runtime/build issues | \`error-handling\` | \`troubleshooting\` |
| Repeated unsafe patterns | \`error-handling\` | \`common-anti-patterns\` |
`;
