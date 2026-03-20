# mb-cli

`mb-cli` is a bootstrap CLI and local MCP runtime for Memory Bank.

The package is intended to be installed globally and expose the `mb` command:

```bash
npm install -g mb-cli
```

After installation, agent providers can launch the local MCP runtime through:

```bash
mb mcp serve
```

The MCP runtime exposes a `resolve_context` tool so agents can ask Memory Bank for the applicable user-level rules and skills for the current repository without writing project-local rule files.

The current MVP intentionally focuses on one primary workflow:

```bash
mb init
```

`init` creates a local Memory Bank, prepares a local MCP runtime config, and generates provider-specific integration descriptors for the selected agent providers:

- Codex
- Cursor
- Claude Code

## Storage Model

The local bank is stored under `~/.memory-bank` and separates `rules` from `skills`.

- `rules/` are clustered by topic, stack, or provider.
- `skills/` are stored as individual files.
- `manifest.json` stores metadata only.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
npm run lint
```

## MCP Runtime

The CLI exposes an internal runtime entrypoint:

```bash
mb mcp serve
```

This starts a local stdio MCP server backed by the managed Memory Bank.

## Publish Notes

The published package includes only the compiled `dist/` output plus top-level project metadata.

- `mb` is exposed through the package `bin` field.
- `prepack` runs `npm run build` before packing or publishing.
- Provider integrations assume `mb` is available globally on `PATH`.
