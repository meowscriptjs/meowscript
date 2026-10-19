/**
 * MeowScript language modules, browser-safe.
 *
 * Unlike the root `@meowscriptjs/meowscript` entry point, this subpath only
 * re-exports the lexer, parser, error types and block catalog: pure ESM with
 * no Node built-ins, so it can be bundled for browsers, web workers and
 * editor tooling (e.g. the VS Code extension under `editors/vscode/`).
 */
export { tokenize } from "./lexer.js";
export { parse } from "./parser.js";
export { MeowError, LexError, ParseError } from "./errors.js";
export * from "./catalog.js";
