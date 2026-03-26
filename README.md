# mb-cli

`mb-cli` is the bootstrap CLI and local MCP runtime for Memory Bank.

It is meant to be installed globally and expose the `mb` command:

```bash
npm install -g mb-cli
```

## Public CLI

The current public CLI intentionally stays small:

```bash
mb init
mb mcp serve
```

- `mb init` bootstraps the local Memory Bank under `~/.memory-bank`, writes the MCP server config, and installs provider-specific integration descriptors.
- `mb mcp serve` starts the local stdio MCP runtime backed by the managed Memory Bank.

The current MVP supports these provider integrations:

- Codex
- Cursor
- Claude Code

## Init Notes

`mb init` currently requires an interactive terminal.

Before running it:

- install at least one supported provider CLI
- make sure that provider CLI is available on `PATH`

During `mb init`, the CLI asks which available providers should be connected.

## Storage Model

The local bank is stored under `~/.memory-bank` and uses layered storage:

- `shared/` for reusable cross-project canonical entries
- `projects/<project-id>/` for project-specific canonical entries

Canonical entry model:

- `rules/` are thematic Markdown files grouped by topic, stack, or provider
- `skills/` are one folder per skill, each containing a single `SKILL.md`
- canonical frontmatter is required for both rules and skills
- `manifest.json` stores Memory Bank metadata

## MCP Runtime

The local runtime is the main agent interface for Memory Bank.

Current MCP tools include:

- `resolve_context`
- `create_bank`
- `sync_bank`
- `set_project_state`
- `upsert_rule`
- `upsert_skill`
- `delete_entry`
- `list_entries`
- `read_entry`
- manifest/read tools for managed storage

`resolve_context` is the normal runtime entrypoint. It returns either ready context or a short next-step instruction when project setup is still missing or requires sync.

`create_bank` is iterative. The server returns the prompt for the current step, and the agent continues by calling `create_bank` again with the next `iteration`.

## Alpha Runbook

Minimal first-run flow:

1. Install `mb-cli` globally.
2. Run `mb init` in an interactive terminal and connect at least one available provider.
3. Start or let the provider start `mb mcp serve`.
4. In a project session, the agent calls `resolve_context` with the absolute project path.
5. If the project bank is missing, the agent calls `create_bank` and follows the iterative flow.
6. If the bank requires storage-version reconciliation, the agent calls `sync_bank`.
7. The agent writes canonical rules and skills through MCP mutation tools only.

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
