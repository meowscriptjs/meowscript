// Bundles the MeowScript extension into a single ESM file that both the
// desktop extension host and the web (browser worker) extension host can load.
//
//   node esbuild.mjs          one-shot build -> dist/web/extension.js
//   node esbuild.mjs --watch  rebuild on change
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/web/extension.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  // Provided by the extension host at runtime, never bundled.
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
