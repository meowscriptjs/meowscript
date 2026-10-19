# MeowScript Language Features (VS Code)

Language support for [MeowScript](https://github.com/meowscriptjs/meowscript) —
a JS-like DSL that compiles to Scratch 3 / PenguinMod projects.

## Features

- Syntax highlighting for `.ms` files (TextMate grammar)
- Comment toggling, auto-closing pairs and bracket matching
- Statement snippets (`sprite`, `when greenFlag`, `function`, …)
- Diagnostics from the real MeowScript lexer/parser (currently the first error per file)
- Completions for every catalog block (`motion.*`, `looks.*`, …), keywords,
  hat events and list methods, driven by the compiler's own block catalog

The extension is web-compatible: it uses no Node APIs and bundles to a single
ESM file, so it runs on vscode.dev, github.dev, code-server and the desktop.

## Development

```bash
cd editors/vscode
npm install
npm run build      # bundle to dist/web/extension.js
npm run typecheck  # tsc --noEmit
npm run test:web   # smoke tests in a browser via @vscode/test-web
```

Open this directory in VS Code and use the **Run Desktop Extension** or **Run
Web Extension** launch configuration to debug.

The extension imports the compiler's browser-safe modules
(`src/lexer.js`, `src/parser.js`, `src/errors.js`, `src/catalog.js`) directly
from the repository, so it never goes out of sync with the language itself.

## Packaging

```bash
npm run package    # -> meowscript-language-<version>.vsix
```

Publishing to VS Code Marketplace and Open VSX happens in CI only when the pushed
tag is `v<version>`, where `<version>` matches `editors/vscode/package.json`.
Other release tags skip extension publishing. Bump the extension version before
creating its matching tag for a new extension release; each version uses one tag.
