export const TYPESCRIPT_DERIVE_GUIDANCE = `## TypeScript Evidence Gate

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
