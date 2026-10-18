import * as vscode from "vscode";
import { CATALOG, LIST_OPS, blockNames } from "../../../src/catalog.js";
import { MeowError } from "../../../src/errors.js";
import { parse } from "../../../src/parser.js";

const LANGUAGE_ID = "meowscript";
const DEBOUNCE_MS = 300;

/** Statement-level keywords, mirroring src/parser.js. */
const KEYWORDS = [
  "sprite",
  "stage",
  "let",
  "cloud",
  "list",
  "function",
  "returning",
  "warp",
  "when",
  "if",
  "else",
  "repeat",
  "while",
  "forever",
  "return",
  "and",
  "or",
  "not",
];

/**
 * Bare event names accepted after `when` — the catalog's own hat names plus
 * the short aliases mirrored from HAT_ALIASES in src/compiler.js.
 */
const HAT_NAMES = new Set<string>([
  "greenFlag",
  "keyPressed",
  "spriteClicked",
  "thisSpriteClicked",
  "stageClicked",
  "cloneStart",
  "startAsClone",
  "broadcast",
  "broadcastReceived",
  "backdropSwitchesTo",
  "loudnessGreaterThan",
  "timerGreaterThan",
  ...blockNames()
    .filter((name) => (CATALOG[name] as { kind?: string }).kind === "hat")
    .map((name) => name.slice(name.indexOf(".") + 1)),
]);

/** Block categories, derived from the catalog. */
const CATEGORIES = new Set(
  blockNames().map((name) => name.slice(0, name.indexOf("."))),
);

/** List method names and their aliases (LIST_OPS in src/catalog.js). */
const LIST_METHODS: string[] = Object.entries(LIST_OPS).flatMap(
  ([name, op]) => [name, ...((op as { aliases?: string[] }).aliases ?? [])],
);

function kindFor(entry: { kind?: string }): vscode.CompletionItemKind {
  switch (entry.kind) {
    case "hat":
      return vscode.CompletionItemKind.Event;
    case "command":
      return vscode.CompletionItemKind.Method;
    case "boolean":
      return vscode.CompletionItemKind.Constant;
    default:
      return vscode.CompletionItemKind.Function;
  }
}

/**
 * Completions after `<qualifier>.` and, in expression/statement position,
 * keywords, hat events and every catalog block name.
 */
class MeowScriptCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const linePrefix = document
      .lineAt(position)
      .text.slice(0, position.character);

    // `<qualifier>.<typed>` context: category blocks or list methods.
    const dotted = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(linePrefix);
    if (dotted) {
      const [, qualifier, typed] = dotted;
      const replaceRange = new vscode.Range(
        position.line,
        position.character - typed.length,
        position.line,
        position.character,
      );

      if (CATEGORIES.has(qualifier)) {
        return blockNames()
          .filter((name) => name.startsWith(`${qualifier}.`))
          .map((name) => {
            const entry = CATALOG[name];
            const item = new vscode.CompletionItem(
              name.slice(qualifier.length + 1),
              kindFor(entry),
            );
            item.detail = name;
            item.range = replaceRange;
            return item;
          });
      }

      // Not a known category — the qualifier may be a list.
      return LIST_METHODS.map((method) => {
        const item = new vscode.CompletionItem(
          method,
          vscode.CompletionItemKind.Method,
        );
        item.detail = "list method";
        item.range = replaceRange;
        return item;
      });
    }

    // General context: keywords, hats, constants, then full block names.
    const items: vscode.CompletionItem[] = [];
    for (const keyword of KEYWORDS) {
      const item = new vscode.CompletionItem(
        keyword,
        vscode.CompletionItemKind.Keyword,
      );
      item.sortText = `0-${keyword}`;
      items.push(item);
    }
    for (const hat of [...HAT_NAMES].sort()) {
      const item = new vscode.CompletionItem(
        hat,
        vscode.CompletionItemKind.Event,
      );
      item.detail = "event hat";
      item.sortText = `1-${hat}`;
      items.push(item);
    }
    for (const name of ["true", "false"]) {
      const item = new vscode.CompletionItem(
        name,
        vscode.CompletionItemKind.Constant,
      );
      item.sortText = `1-${name}`;
      items.push(item);
    }
    for (const name of blockNames()) {
      const item = new vscode.CompletionItem(name, kindFor(CATALOG[name]));
      item.detail = name;
      item.sortText = `2-${name}`;
      items.push(item);
    }
    return items;
  }
}

/** Pending debounced validations, keyed by document URI. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Parse the document and publish any lexical/syntax error as a diagnostic.
 * `parse` runs the lexer first, so LexErrors surface the same way.
 */
function refreshDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
): void {
  if (document.languageId !== LANGUAGE_ID) return;

  try {
    parse(document.getText(), document.uri.toString());
    collection.delete(document.uri);
  } catch (error) {
    collection.set(document.uri, [toDiagnostic(error, document)]);
  }
}

/** Convert a thrown MeowError (or anything else) into a diagnostic. */
function toDiagnostic(
  error: unknown,
  document: vscode.TextDocument,
): vscode.Diagnostic {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  // Errors carry 1-based line/column; VS Code ranges are 0-based.
  const rawLine = error instanceof MeowError ? error.line : undefined;
  const rawColumn = error instanceof MeowError ? error.column : undefined;
  const line = Math.max(0, (rawLine ?? 1) - 1);
  const column = Math.max(0, (rawColumn ?? 1) - 1);

  // Underline from the reported column to the end of the line, falling back
  // to a zero-width range at the clamp point (e.g. errors at EOF).
  const lineLength =
    line < document.lineCount ? document.lineAt(line).text.length : 0;
  const startCharacter = Math.min(column, lineLength);
  const endCharacter = Math.max(startCharacter, lineLength);
  const range = new vscode.Range(line, startCharacter, line, endCharacter);

  const diagnostic = new vscode.Diagnostic(
    range,
    message,
    vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = LANGUAGE_ID;
  diagnostic.code = name; // LexError / ParseError / …
  return diagnostic;
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  context.subscriptions.push(collection);

  const schedule = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    const pending = debounceTimers.get(key);
    if (pending) clearTimeout(pending);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        refreshDiagnostics(document, collection);
      }, DEBOUNCE_MS),
    );
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: LANGUAGE_ID },
      new MeowScriptCompletionProvider(),
      ".", // trigger category/list-method completion after the dot
    ),
    vscode.workspace.onDidOpenTextDocument((document) =>
      refreshDiagnostics(document, collection),
    ),
    vscode.workspace.onDidChangeTextDocument((event) =>
      schedule(event.document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const pending = debounceTimers.get(key);
      if (pending) clearTimeout(pending);
      debounceTimers.delete(key);
      collection.delete(document.uri);
    }),
  );

  // Pick up documents that were already open when the extension activated.
  for (const document of vscode.workspace.textDocuments) {
    refreshDiagnostics(document, collection);
  }
}

export function deactivate(): void {
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
}
