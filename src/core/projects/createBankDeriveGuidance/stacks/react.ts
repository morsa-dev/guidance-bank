export const REACT_DERIVE_GUIDANCE = `## React Guidance

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
