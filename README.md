# memory-bank-local

`memory-bank-local` is a local Memory Bank runtime and MCP host for coding agents.

It gives the agent one managed, canonical place for reusable rules and skills outside the repository, while still allowing repository-local guidance such as `AGENTS.md`, `.cursor`, `.claude`, or `.codex` to coexist separately.

## What The Product Does

Memory Bank solves one practical problem: project guidance is usually scattered.

Some instructions live in provider-specific files inside repositories. Some are reusable across many repositories. Some are stable project conventions that should survive across sessions. `memory-bank-local` gives the agent a local MCP-backed Memory Bank for that durable guidance.

In practice, it provides:

- a local managed storage under `~/.memory-bank`
- a local MCP server that agents can call during work
- a bootstrap flow for connecting supported agent providers
- a canonical model for `rules` and `skills`

## How It Works

At runtime, the normal flow looks like this:

1. Your agent calls `resolve_context` with the absolute project path.
2. Memory Bank checks whether a project-specific bank already exists.
3. If it exists and is ready, Memory Bank returns the applicable canonical rules and skills.
4. If it does not exist yet, Memory Bank tells the agent to start `create_bank`.
5. The agent goes through the iterative `create_bank` flow, reviews existing guidance, derives stable rules from the project, and writes canonical entries through MCP tools.

Important boundaries:

- Memory Bank is the primary user-managed context layer.
- Repository-local provider guidance is not the same thing as Memory Bank.
- Repository-local guidance may be reviewed during project-bank creation, but it is not injected into normal runtime context automatically.

## Installation

Install the package globally so the `mb` command is available on your `PATH`:

```bash
npm install -g memory-bank-local
```

After installation, the public CLI is:

```bash
mb init
mb stats
mb mcp serve
```

## First Setup

Run:

```bash
mb init
```

What it does:

- creates the local Memory Bank under `~/.memory-bank`
- writes the MCP server config used by providers
- installs provider-specific integration descriptors

Current provider integrations:

- Codex
- Cursor
- Claude Code

Current MVP note:

- `mb init` requires an interactive terminal
- at least one supported provider CLI must already be installed and available on `PATH`

## First Project Run

Minimal alpha flow:

1. Run `mb init`.
2. Start or let your provider start `mb mcp serve`.
3. Open a project in the agent.
4. The agent calls `resolve_context` with the absolute project path.
5. If the project bank is missing, the agent calls `create_bank` and follows the iterative creation flow.
6. The agent writes canonical Memory Bank entries through MCP mutation tools.

## Canonical Storage Model

Memory Bank uses layered storage:

- `~/.memory-bank/shared/...`
- `~/.memory-bank/projects/<project-id>/...`

Canonical entry model:

- `rules/` are thematic Markdown files grouped by topic, stack, or provider
- `skills/` are one folder per skill, each containing a single `SKILL.md`
- canonical frontmatter is required for both rules and skills

This means Memory Bank is not a dump of arbitrary notes. It is managed canonical context with a strict shape.

## MCP Runtime

`mb mcp serve` starts the local stdio MCP server.

Current MCP tools include:

- `resolve_context`
- `create_bank`
- `clear_project_bank`
- `sync_bank`
- `set_project_state`
- `upsert_rule`
- `upsert_skill`
- `delete_entry`
- `list_entries`
- `read_entry`

## Stats

Use `mb stats` for a local overview of the Memory Bank state and recent audit activity.

Examples:

```bash
mb stats
mb stats --project /absolute/project/path
mb stats --json
```

The command shows:

- shared rule and skill counts
- project bank counts and creation states
- recent audit events
- tool and provider activity breakdowns

The important ones for normal agent work are:

- `resolve_context` for runtime context resolution
- `create_bank` for iterative project-bank creation
- `upsert_rule` and `upsert_skill` for canonical writes

## Development

```bash
npm install
npm run build
npm run lint
npm run typecheck
npm test
```

## Publish Notes

The published package includes the compiled `dist/` output plus top-level project metadata.

- `mb` is exposed through the package `bin` field
- `prepack` runs `npm run build` before packing or publishing
- provider integrations assume `mb` is available globally on `PATH`
