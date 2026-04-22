export const OTHER_DERIVE_GUIDANCE = `## Unknown or Mixed Stack Guidance

The stack is not confidently identified or does not match known stack routes.
Build stack-aware guidance without forcing unsupported framework assumptions.

## Stack Identification Pass

Infer the most likely stack from project fingerprints:
- runtime/platform markers (for example: \`package.json\`, \`pyproject.toml\`, \`go.mod\`, \`pom.xml\`, \`*.csproj\`, \`Gemfile\`)
- framework markers (dependencies, CLI configs, routing/bootstrap entry files)
- build/test/tooling markers (linters, test runners, bundlers, CI scripts)

Classify confidence explicitly:
- high confidence: one dominant stack is clearly supported by code/config evidence
- medium confidence: multiple plausible stacks or mixed architecture
- low confidence: minimal or conflicting evidence

## Stack-Specific Fallback Strategy

- If confidence is high and trusted docs are helpful, use them only as a secondary source for best-practice alignment.
- Keep project evidence as the primary source; external guidance should refine, not override, observed project patterns.
- If confidence is medium/low, prefer conservative, technology-neutral rules and avoid stack-specific APIs not proven in the repository.

## Output Size by Evidence Strength

- High confidence + sufficient codebase: generate a normal stack-oriented set.
- Medium confidence: generate a smaller set focused on stable cross-cutting decisions visible in code.
- Low confidence or near-empty project: generate only a minimal scaffold that can evolve (baseline structure rules + a small core skill set).

## Ambiguity Markers

- Mark uncertain stack decisions with \`[VERIFY: what to confirm]\`.
- Keep each uncertain point scoped and actionable for future refinement.
`;
