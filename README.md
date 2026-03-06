# EnvGuardian

> Eliminate runtime crashes caused by undefined environment variables.

EnvGuardian is a VS Code extension for Node.js projects that scans all source files for `process.env.*` usages, tracks all `.env*` files, and surfaces missing variables so you catch problems at development time — not in production.

---

## Features

### Sidebar: Missing Variables Panel

Open any `.env*` file to see a list of every `process.env` variable referenced in your source code that is **not** defined in that file.

- Flat list sorted alphabetically
- Each item shows the first usage location (`src/api/client.ts:14`) and a count of additional usages
- Hover for the full list of all file:line references
- Refreshes automatically on file save or when you switch editors

### Inline Diagnostics (Squiggles)

- **Warning** — variable is not defined in *any* `.env*` file in the workspace
- **Information** — variable is defined in some files but missing from others (e.g. in `.env.development` but not `.env.production`)

Diagnostics update live as you edit source files or save `.env*` files.

### Quick Fix Code Actions

Right-click a warning squiggle and choose:
- **Add `VAR_NAME` to .env file…** — pick which `.env*` file to add the stub to
- **Add `VAR_NAME` to all .env files** — adds `VAR_NAME=` to every `.env*` file that's missing it

### Commands

| Command | Description |
|---|---|
| `EnvGuardian: Refresh` | Force-refresh the sidebar tree view |
| `Copy Variable Name` | Copy the missing variable name to the clipboard |
| `Add to .env File` | Append `VAR_NAME=` to the currently active `.env*` file |
| `Go to Usage` | Navigate to the usage in source code (QuickPick if multiple) |

---

## How It Works

**Scanning** — on activation, EnvGuardian scans all `.js`, `.ts`, `.jsx`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts` files for `process.env.*` references using regex matching (not a full AST parser, so it's fast). It skips `node_modules`, `dist`, `build`, `.next`, and `coverage`.

**Env file parsing** — all `.env*` files at the workspace root are parsed for `KEY=` definitions. The value is ignored; presence of the key is all that matters.

**Comparison** — the sidebar and diagnostics compare the set of *used* variables against the set of *defined* variables to find the gap.

---

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `envGuardian.sourceGlobs` | `["**/*.{js,ts,jsx,tsx,mjs,cjs,mts,cts}"]` | Glob patterns for source files to scan |
| `envGuardian.excludeGlobs` | `["**/node_modules/**", ...]` | Glob patterns to exclude from scanning |
| `envGuardian.envFilePattern` | `.env*` | Glob for environment files at workspace root |
| `envGuardian.diagnostics.enabled` | `true` | Show inline squiggles in source files |
| `envGuardian.diagnostics.partialWarnings` | `true` | Show Info diagnostics for partially-defined variables |

---

## Known Limitations

- **Dynamic access is not tracked.** `process.env[dynamicVar]` is intentionally ignored — only statically analyzable string keys are indexed.
- **Comments are scanned.** A `// process.env.FOO` in a comment will be tracked. This is intentional as commented-out references are still a useful signal.
- **Only workspace-root `.env*` files** are tracked. Nested env files in subdirectories are ignored.
- **Multi-root workspaces** are supported; each folder is scanned independently.

---

## Activation

EnvGuardian activates automatically when a `package.json` is found in the workspace, indicating a Node.js project.

---

## Development

```bash
npm install
npm run compile        # one-shot TypeScript compile
npm run watch          # watch mode

# Run unit tests (no VS Code required):
npx mocha --require ./test/vscode-mock.js --ui tdd out/test/suite/*.test.js
```

To run the full integration test suite, open the project in VS Code and press `F5` to launch the Extension Development Host, then run `npm test`.

---

## Future Enhancements (v2+)

- **IntelliSense completions** for `process.env.` based on defined variables
- **Hover value preview** — see a variable's value from each env file on hover
- **Diff view** — compare two `.env` files side-by-side
- **Export** — generate a `.env.example` from all discovered usages
