import * as vscode from "vscode";

/**
 * Minimal harness: @vscode/test-web loads this module inside the browser
 * extension host and awaits the exported run(). No Node built-ins are
 * available there, so we cannot use node:test or node:assert.
 */
interface TestCase {
  name: string;
  fn: () => Promise<void> | void;
}

const tests: TestCase[] = [];

function test(name: string, fn: () => Promise<void> | void): void {
  tests.push({ name, fn });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor<T>(
  get: () => T | undefined,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = get();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------------------------------------------------------------------------

test("extension activates", async () => {
  const extension = vscode.extensions.getExtension(
    "meowscriptjs.meowscript-language",
  );
  assert(extension, "extension not found in test host");
  await extension.activate();
});

test("syntax errors become diagnostics", async () => {
  const document = await vscode.workspace.openTextDocument({
    language: "meowscript",
    content: 'sprite "Cat" {\n  let x = ;\n',
  });
  const diagnostics = await waitFor(() => {
    const found = vscode.languages.getDiagnostics(document.uri);
    return found.length > 0 ? found : undefined;
  }, "diagnostics for an invalid document");
  assert(
    diagnostics[0].severity === vscode.DiagnosticSeverity.Error,
    "not an error",
  );
  assert(diagnostics[0].source === "meowscript", "wrong diagnostic source");
});

test("valid documents stay clean", async () => {
  const document = await vscode.workspace.openTextDocument({
    language: "meowscript",
    content:
      'sprite "Cat" {\n  when greenFlag {\n    motion.moveSteps(10);\n  }\n}\n',
  });
  // Give the debounced validation (300ms) time to run and clear.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const diagnostics = vscode.languages.getDiagnostics(document.uri);
  assert(
    diagnostics.length === 0,
    `unexpected diagnostics: ${diagnostics.map((d) => d.message).join("; ")}`,
  );
});

test("completes catalog blocks after a category dot", async () => {
  const document = await vscode.workspace.openTextDocument({
    language: "meowscript",
    content: "motion.",
  });
  await vscode.window.showTextDocument(document);
  const result = (await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    document.uri,
    new vscode.Position(0, 7),
    ".",
  )) as vscode.CompletionList;
  const labels = result.items.map((item) => String(item.label));
  assert(
    labels.includes("moveSteps"),
    `moveSteps missing from: ${labels.join(", ")}`,
  );
  assert(
    labels.includes("goToXY"),
    `goToXY missing from: ${labels.join(", ")}`,
  );
  assert(
    !labels.some((label) => label.startsWith("looks.")),
    "other categories leaked in",
  );
});

test("completes hat events in plain context", async () => {
  const document = await vscode.workspace.openTextDocument({
    language: "meowscript",
    content: "when ",
  });
  await vscode.window.showTextDocument(document);
  const result = (await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    document.uri,
    new vscode.Position(0, 5),
  )) as vscode.CompletionList;
  const labels = result.items.map((item) => String(item.label));
  assert(labels.includes("greenFlag"), "greenFlag hat completion missing");
  assert(labels.includes("keyPressed"), "keyPressed hat completion missing");
});

test("completes list methods after a list dot", async () => {
  const document = await vscode.workspace.openTextDocument({
    language: "meowscript",
    content: "items.",
  });
  await vscode.window.showTextDocument(document);
  const result = (await vscode.commands.executeCommand(
    "vscode.executeCompletionItemProvider",
    document.uri,
    new vscode.Position(0, 6),
    ".",
  )) as vscode.CompletionList;
  const labels = result.items.map((item) => String(item.label));
  assert(labels.includes("push"), "push list-method completion missing");
  assert(
    labels.includes("deleteAt"),
    "deleteAt list-method completion missing",
  );
});

// ---------------------------------------------------------------------------

export async function run(): Promise<void> {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      failed++;
      console.error(
        `not ok - ${name}: ${error instanceof Error ? error.stack : error}`,
      );
    }
  }
  if (failed > 0) {
    throw new Error(
      `${failed} of ${tests.length} web extension test(s) failed`,
    );
  }
  console.log(`all ${tests.length} web extension tests passed`);
}
