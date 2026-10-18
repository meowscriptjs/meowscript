import * as vscode from "vscode";
import { MeowError } from "../../../src/errors.js";
import { parse } from "../../../src/parser.js";

const LANGUAGE_ID = "meowscript";
const DEBOUNCE_MS = 300;

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
