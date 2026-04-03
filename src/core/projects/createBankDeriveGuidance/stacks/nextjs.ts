export const NEXTJS_DERIVE_GUIDANCE = `## Next.js Guidance

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
