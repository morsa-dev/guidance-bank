export const IOS_DERIVE_GUIDANCE = `## iOS Guidance

Focus on Swift/iOS patterns: feature structure, navigation, state model, async flow, services, testing, and UI boundaries.

Structure discovery:
- identify where app source code lives
- map feature/module hierarchy 2-3 levels deep
- identify SwiftUI, UIKit, or mixed usage

Pattern extraction:
- feature structure: placement of views, reducers/view models, services, and models
- UI layer: view composition, naming, and ownership boundaries
- state layer: reducer/store/view model patterns and side-effect ownership
- navigation: route/coordinator/navigation stack conventions
- services/data: API client structure, mapping, error handling
- concurrency: Task/async-await or callback/Combine patterns
- testing: XCTest structure, mocking style, critical test expectations

Config and tooling analysis:
- Package.swift
- Podfile
- xcodeproj / xcworkspace layout
- SwiftLint or project lint config
- scheme/build settings when they are clearly relevant

Version and feature gate:
- verify SwiftUI vs UIKit vs mixed architecture from real files
- do not force TCA, MVVM, or coordinator patterns unless project evidence supports them

Red flags to elevate only if repeated:
- business logic inside views
- inconsistent navigation ownership
- duplicated mapping between transport and UI/domain models
- side effects without clear ownership boundaries
- repeated force unwraps or unsafe threading around async work

Likely rule topics when evidence supports them:
- architecture
- ui-composition
- navigation
- state-management
- services-data
- concurrency
- testing
- styling-ui

Likely skills when evidence supports them:
- adding-feature
- adding-service
- code-review
- troubleshooting`;
