export const IOS_DERIVE_GUIDANCE = `## iOS Guidance

Focus on iOS/Swift patterns: SwiftUI, UIKit, architecture boundaries, state and async flow, navigation, services, testing, and UI boundaries.
Treat SwiftUI, UIKit, TCA, MVVM, coordinators, and KMM as possible branches, not defaults. Promote only patterns that are supported by file-path evidence in this codebase.

## Codebase Exploration Before Generating

### Structure Discovery

1. List contents of the root directory.
2. Identify main source folders (for example: \`Sources/\`, \`Features/\`, \`App/\`, \`Modules/\`).
3. Map the folder hierarchy 2-3 levels deep.
4. Record the exact folder names and paths you found.

### Pattern Extraction (Read Actual Files)

For each category, read 2-3 representative Swift files and extract patterns:

| Category | What to Find | What to Extract |
|----------|--------------|-----------------|
| Features/Screens | Feature folders (\`*View.swift\`, \`*ViewModel.swift\`, \`*Reducer.swift\`, \`*Coordinator.swift\`) | Screen/module structure and the actual local architecture pattern |
| Services | Service files (\`*Service.swift\`, \`*Actor.swift\`) | Protocol abstraction, actor usage, async/await |
| Views | SwiftUI views (\`*View.swift\`) | View composition, modifiers, environment usage |
| Models/Entities | Entity files (\`*Entity.swift\`, \`*Model.swift\`) | Codable, Equatable, Identifiable conformances |
| Tests | Test files (\`*Tests.swift\`) | XCTest structure, mocking, and any framework-specific helpers actually in use |
| Navigation | Coordinator/Router files | NavigationStack, NavigationPath, coordinator, tab flow, or custom navigation ownership |
| Dependencies | DI files (\`*Dependency.swift\`, \`*Client.swift\`, container or factory files) | TCA Dependencies, factories, constructor injection, or custom DI container |
| Shared Modules | Shared components or modules folders | Reusable SwiftUI/UIKit components, styling tokens, app-wide primitives |
| Platform Integration | App lifecycle, notifications, widgets, extensions, deep links | Runtime boundaries and platform-specific integration points |
| KMM Integration | KMM wrapper files | ResultWrapper handling, entity mapping, only if present |

### Config and Dependency Analysis (iOS-Specific)

Read these iOS project files if they exist:
- \`Package.swift\` (SPM dependencies and targets)
- \`Podfile\` (CocoaPods dependencies)
- \`*.xcodeproj\` / \`*.xcworkspace\` / \`project.pbxproj\`
- \`Cartfile\` (Carthage, if used)
- app entry point: \`@main App.swift\`, \`AppDelegate.swift\`, \`SceneDelegate.swift\`
- architecture entry points only when present: \`AppReducer.swift\`, \`AppView.swift\`, root coordinator, root router
- build configs: \`*.xcconfig\`, \`Info.plist\`, build phases
- linter configs: \`.swiftlint.yml\`, \`.swiftformat\`
- platform integration configs: widget/extension targets, deep-link registration, notification setup
- KMM: \`shared/\` folder, \`KMMWrapper.swift\`, framework imports

### Version and Feature Gate (iOS)

Before turning patterns into rules, verify what is actually used in this codebase:
- UI framework mode: SwiftUI, UIKit, or mixed.
- Architecture style: TCA, MVVM, MVC, VIPER, Clean, coordinator-driven, lightweight screen logic, or mixed.
- Async style: async/await, Combine, callbacks, or mixed.
- Dependency pattern: TCA Dependencies, Resolver/Factory, constructor injection, manual injection, or mixed.
- Navigation ownership: NavigationStack, coordinator/router, UIKit navigation controller, or mixed.
- Platform surface: app-only, app + widgets/extensions, deep links, notifications, or mixed.
- Do not force TCA, MVVM, coordinators, KMM, or any other architecture pattern unless project evidence supports them.
- If the project is simple SwiftUI/UIKit without a heavyweight architecture, preserve that simplicity instead of inventing extra layers.

### Red Flag Detection (Swift-Specific)

Search for recurring iOS/Swift problems that should become explicit rules:
- \`// TODO:\`, \`// FIXME:\`, \`// HACK:\` comments
- \`// swiftlint:disable\` usage
- \`@MainActor\` missing where needed, or overused
- force unwraps \`!\` outside of tests or IBOutlets
- \`print()\` statements in production code
- hardcoded strings that should be localized
- hardcoded colors/spacing where shared tokens/components exist
- direct service instantiation instead of dependency injection
- side effects in SwiftUI view body or reducer body
- \`Task { }\` without proper cancellation handling
- missing \`Equatable\`/\`Sendable\` conformances where needed
- inconsistent async/await vs Combine usage
- navigation logic leaking into unrelated view/service layers
- UIKit/SwiftUI bridging patterns that are repeated but undocumented
- extension/widget/deep-link boundaries handled inconsistently

### Code Style Extraction (Swift)

From representative Swift files, identify:
- import order: \`Foundation\` -> \`SwiftUI/UIKit\` -> third-party -> local modules
- access control patterns: \`private\`, \`internal\`, \`public\` usage
- type naming: \`PascalCase\` for types, \`camelCase\` for properties/methods
- file naming: \`FeatureNameView.swift\`, \`FeatureNameReducer.swift\`, \`FeatureNameViewModel.swift\`, etc.
- extension organization: separate extensions for protocol conformances
- MARK comments: \`// MARK: -\` usage for code organization
- documentation: \`///\` doc comments on public APIs
- property wrappers: \`@State\`, \`@Binding\`, \`@Environment\`, \`@Dependency\`, \`@Observable\` patterns
- closure syntax: trailing closure conventions
- guard vs if-let patterns

### Analysis Checklist (iOS Project)

Document these with file path evidence:

- Architecture and feature module organization.
- UI framework mode and screen composition patterns.
- State management and async model.
- Dependency injection and service/client pattern.
- Navigation strategy and ownership.
- Platform integration boundaries (widgets, extensions, notifications, deep links) if present.
- Networking/persistence/KMM integration, if present.
- Testing approach and helper usage.
- Code style conventions that are not already enforced by formatters.
- Main recurring anti-patterns and where they appear.

Before final output, gather concrete evidence for each applicable item.
If evidence remains partial, continue conservatively and mark uncertainty with \`[VERIFY: ...]\` instead of blocking output.

### Generation Locks (Prevent Architecture Drift)

Apply these constraints when generating rules and skills:
- Preserve detected architecture (TCA/MVVM/coordinator/simple SwiftUI/UIKit/etc.) and do not migrate implicitly.
- Preserve detected UI framework mode (SwiftUI/UIKit/mixed).
- Preserve dependency injection and service ownership model.
- Preserve navigation ownership model.
- Preserve concurrency model unless strong project evidence suggests convergence.
- Preserve the observed complexity level: if the project uses lightweight patterns, do not generate enterprise-style layers.
- Preserve build/runtime and module-boundary assumptions.

## Skill Candidates (iOS)

Generate these skills with actual project paths and Swift-specific workflow steps:
Generate only skills that have clear project evidence and practical value.
For small/low-confidence projects, 2-4 core skills are usually enough.

### adding-feature
- Include actual feature folder structure used in this project.
- Reference real View/ViewModel/Reducer/Coordinator files as templates based on the detected local architecture.
- Show step-by-step for the detected architecture pattern only.
- Include navigation and parent integration when relevant.

### adding-service
- Include actual service/client file paths and dependency registration style.
- Show protocol definition, implementation, registration, and async/error handling.
- Include mocking/test strategy for service behavior.

### code-review
- Include iOS/Swift-specific review checklist based on project patterns.
- Cover architecture compliance, UI composition, async handling, dependency use, and testing.

### common-anti-patterns
- Include recurring Swift/iOS anti-patterns from this project.
- Pair each anti-pattern with the preferred local alternative.

### troubleshooting
- Include common build/runtime/test issues for this codebase.
- Include where to inspect first when these issues happen.

### [framework-specific]
Generate 1-3 additional skills based on actual stack usage:
- tca-patterns (if TCA is primary)
- mvvm-patterns (if MVVM or view-model-heavy flow is primary)
- coordinator-patterns (if coordinator/router ownership is central)
- kmm-integration (if shared/KMM is present)
- adding-widget (if reusable widget/component system is central)
- extension-workflows (if widgets/extensions/deep links are central)
- [domain]-workflows (if a domain workflow is clearly repeated)

### enrichment-tasks (optional)
- Generate this only when the user explicitly asks for enrichment, or when analysis shows a clear gap in the existing rule/skill bank.

## Rule Generation Requirements

### What NOT to Include

- Do not invent generic philosophy ("clean code", "think about user").
- Do not duplicate what linters/formatters enforce.
- Do not add rules without evidence from codebase patterns.
- Do not repeat rules across multiple files.

### Rule Content Requirements

Keep this section iOS-specific:
- Capture decisions tied to Swift architecture and app structure (TCA/MVVM, navigation, DI, async model).
- Prefer Swift-native patterns and terminology over generic cross-stack wording.
- Highlight iOS-specific risks and anti-patterns that recur in this codebase.
- Match the actual architecture level of the project; do not upscale a lightweight codebase into a layered architecture just because the stack allows it.

## Algorithm: Analysis -> Rules (iOS)

Follow this systematic approach for iOS projects:

**Structure -> Architecture Rules:**
1. Detect patterns in feature folders and module layout.
2. Generate placement rules for the artifacts that actually exist here: views, view models, reducers, coordinators, services, models, modules.
3. Document module boundaries and what can import what.

**Swift Files -> Code Style Rules:**
1. For views, reducers/view models, and services, scan 2-3 representative files each.
2. Identify import grouping, access control, MARK usage, and extension organization.
3. Promote only repeated high-signal conventions.

**Configs -> Architectural Rules:**
1. Inspect Package.swift, Podfile, swiftlint, xcconfig, and project metadata.
2. Create rules for module imports, dependency access, runtime boundaries, and platform integrations.
3. Do not restate what SwiftLint/SwiftFormat already enforce.

**Red Flags -> Safety Rules:**
1. If the same Swift anti-pattern appears repeatedly, define "Avoid X, do Y instead".
2. Reference the actual correct pattern from this repo.

**Tests -> Testing Rules:**
1. Identify test location pattern and XCTest/TestStore usage.
2. Extract mocking and assertion conventions.
3. Require tests only for module types that are consistently tested in this project.

## Recommended Rule Topics (iOS Project)

Split by topic:
Generate only topics that are supported by concrete project evidence.

| Topic | Covers (iOS-Specific) |
|------|------------------------|
| \`architecture\` | TCA/MVVM structure, layers, feature module organization |
| \`code-style\` | Swift naming, imports, access control, MARK comments |
| \`dependencies\` | DI pattern, service protocols, actors, dependency registration |
| \`navigation\` | NavigationStack, Coordinator, or reducer-driven navigation |
| \`swiftui-patterns\` | View composition, modifiers, environment, previews |
| \`uikit-patterns\` | UIViewController patterns, lifecycle, layout (if UIKit) |
| \`tca-patterns\` | Reducer structure, State/Action, effects, testing (if TCA) |
| \`mvvm-patterns\` | ViewModel ownership, bindings, async flow (if MVVM) |
| \`services\` | API clients, persistence, mapping, boundary normalization |
| \`widget-system\` | Reusable UI components and styling tokens |
| \`kmm-integration\` | Shared/KMM wrappers and entity bridging |
| \`platform-integration\` | widgets, extensions, notifications, deep links, app lifecycle boundaries |
| \`testing\` | XCTest patterns, TestStore, mocking, snapshots |
| \`error-handling\` | Error types, logging, user-facing failures |
| \`localization\` | String localization and formatting (if applicable) |

## Context-to-Rule/Skill Mapping (iOS)

Use this mapping to decide what files to generate:
Generate only skills that are supported by concrete project evidence.

| Found in iOS Codebase | Generate Rule Topic | Generate Skill |
|----------------------|---------------------|----------------|
| TCA architecture (\`@Reducer\`, \`Store\`) | \`architecture\`, \`tca-patterns\` | \`adding-feature\` |
| MVVM architecture (\`ObservableObject\`, \`@Observable\`) | \`architecture\`, \`mvvm-patterns\` | \`adding-feature\`, \`mvvm-patterns\` |
| Swift code conventions | \`code-style\` | \`code-review\` |
| TCA Dependencies (\`@Dependency\`) | \`dependencies\` | \`adding-service\` |
| Custom DI (Resolver, Factory) | \`dependencies\` | \`adding-service\` |
| NavigationStack / Coordinator | \`navigation\` | - |
| SwiftUI views | \`swiftui-patterns\` | - |
| UIKit views | \`uikit-patterns\` | - |
| API/Network layer | \`services\` | - |
| Reusable UI components | \`widget-system\` | \`adding-widget\` |
| KMM shared module | \`kmm-integration\` | \`kmm-integration\` |
| Widgets/extensions/deep links | \`platform-integration\` | \`extension-workflows\` |
| XCTest / TCA TestStore | \`testing\` | - |
| Error types, logging | \`error-handling\` | - |
| Localized strings | \`localization\` | - |
| SwiftLint violations | - | \`common-anti-patterns\` |
| Build/runtime issues | - | \`troubleshooting\` |
`;
