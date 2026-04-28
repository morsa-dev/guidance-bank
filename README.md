# @morsa/guidance-bank

`@morsa/guidance-bank` is a local tool for coding agents that stores persistent rules, skills, and reusable project guidance.

It gives agents a stable guidance layer across sessions, projects, and tools.

It gives you one durable place for reusable rules and skills across:

- different agent providers
- different projects
- repeated sessions in the same project

The goal is simple:

- improve agent quality over time
- reduce repeated prompting and repeated context reconstruction
- save tokens by keeping stable guidance in a managed local guidance layer

## Quick Start

Install globally:

```bash
npm install -g @morsa/guidance-bank
```

Initialize once:

```bash
gbank init
```

That is the whole manual setup.

After that, your agent can work with the AI Guidance Bank during normal coding sessions. When a project has no bank yet, the agent can detect that and guide creation as part of the workflow.

## Why It Exists

Agent guidance is usually fragmented.

- Some rules live in `AGENTS.md`.
- Some live in `.cursor`, `.claude`, or `.codex`.
- Some are project-specific.
- Some should be shared across many repositories.
- Most provider-native flows are still weak at generating a good long-lived bank from real project evidence.

`@morsa/guidance-bank` solves that by giving the agent one canonical local AI Guidance Bank it can use across providers and across projects.

It is designed for two kinds of guidance:

- cross-agent reusable guidance shared between projects
- project-specific guidance derived from the actual codebase and stack

## Supported Providers

Current provider integrations:

- Codex
- Cursor
- Claude Code

## What Happens Next

After `gbank init`, the normal flow is intentionally lightweight:

1. You open a project in your agent.
2. The agent resolves AI Guidance Bank context for that project.
3. If a project bank does not exist yet, the agent can propose creating it.
4. The agent can then keep using, improving, syncing, and editing the bank over time.

In practice, the agent can:

- create a project bank
- review and improve an existing bank
- sync an outdated bank layout
- add or update rules
- add or update skills
- delete obsolete entries
- read and inspect existing bank content

The goal is that the agent handles the workflow, instead of you manually managing rule files all the time.

## Why This Is Better Than Provider-Native Rules

Provider-native repository guidance is useful, but usually limited.

Common problems:

- guidance is locked to one provider
- project guidance is hard to reuse across repositories
- generated rule sets often collapse into folder-structure summaries instead of real operational guidance
- stack-specific guidance is usually shallow and repetitive

`@morsa/guidance-bank` aims to build better project guidance by:

- separating shared and project-specific guidance
- deriving rules from real project evidence
- carrying reusable rules across repositories
- keeping one user-managed canonical layer that works with multiple agents

## Stats

Use `gbank stats` for a local overview of the AI Guidance Bank and recent activity:

```bash
gbank stats
gbank stats --project /absolute/project/path
gbank stats --json
```

It currently shows:

- shared rule and skill counts
- project bank counts and creation states
- recent audit events
- tool and provider activity breakdowns

This is the first visibility layer; it will keep getting richer.

## Stop

Use `gbank stop` to disconnect the configured MCP integrations while keeping the local bank on disk:

```bash
gbank stop
```

This is useful when you want to pause usage cleanly, avoid stale provider-side MCP entries, or reconnect later through a fresh `gbank init`.

## What We Plan To Improve

Near-term product direction:

- better visualization of rules and skills
- richer stats, including token-oriented usage and cost insight
- stronger project-bank management workflows
- team and workspace-oriented memory sharing

The long-term direction is not just “local rule files”, but a real guidance layer for agent work across projects, providers, and eventually teams.

## Current Notes

- `gbank init` requires an interactive terminal
- at least one supported provider CLI must already be installed and available on `PATH`
- the local AI Guidance Bank lives under `~/.guidance-bank`
