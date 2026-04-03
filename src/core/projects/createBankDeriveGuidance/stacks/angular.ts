export const ANGULAR_DERIVE_GUIDANCE = `## Angular Guidance

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
