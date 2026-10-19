// Runs the smoke tests in a real browser-based VS Code instance
// (@vscode/test-web) against the unpacked extension in this directory.
//
//   npm run build      # bundles src/ and test/ first
//   npm run test:web
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-web";

await runTests({
  browserType: "chromium",
  extensionDevelopmentPath: fileURLToPath(new URL(".", import.meta.url)),
  extensionTestsPath: fileURLToPath(
    new URL("./dist/test/index.js", import.meta.url),
  ),
});
