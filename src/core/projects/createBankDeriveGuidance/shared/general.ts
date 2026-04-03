export const GENERAL_DERIVE_GUIDANCE = `## General Analysis Contract

Before generating or updating Memory Bank entries:
- Explore the codebase thoroughly before writing
- Prefer project evidence over assumptions
- Generate project-specific rules, not generic copies
- Deduplicate candidate rules before writing
- Keep one clear formulation per rule

## Rule Quality Gate

Create or keep a rule only when at least one is true:
- The pattern appears repeatedly in the codebase
- The pattern is encoded in configuration or tooling
- The pattern is documented and reflected in project structure
- The pattern is clearly part of the intended architecture

For each candidate rule, decide explicitly:
- keep: clear evidence and practical value
- skip: weak evidence or low value
- [VERIFY: ...]: partial evidence and the decision can affect workflow

Safety constraints:
- Prefer rules that reinforce established project workflow over idealized rewrites
- If a rule may disrupt team workflow and evidence is weak, skip it
- If confidence is low for a high-impact decision, use [VERIFY: ...] or ask the user

## Skills Quality Gate

Generate a skill only when it represents a reusable multi-step workflow with clear project evidence.

Each skill should include:
- When to use
- Prerequisites
- Step-by-step workflow with real project paths
- Do not / anti-patterns when relevant

If you generate a reading/index-oriented skill:
- do not output only a static file list
- include conditional routing logic for common task categories
- keep routing concise and directly actionable

## Testing Rules Gate

Before generating testing rules:
- assess how developed testing actually is in this project
- if testing is minimal, do not force broad coverage rules
- add testing rules only when they match actual project practice or explicit user intent
- prefer realistic incremental guidance over idealized requirements`;
