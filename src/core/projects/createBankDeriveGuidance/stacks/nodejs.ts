export const NODEJS_DERIVE_GUIDANCE = `## Node.js Backend Guidance

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
