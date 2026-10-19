// Bundles the MeowScript extension (and its web smoke tests) into single ESM
// files that both the desktop extension host and the web (browser worker)
// extension host can load.
//
//   node esbuild.mjs          one-shot build -> dist/web/
//   node esbuild.mjs --watch  rebuild on change
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // Provided by the extension host at runtime, never bundled.
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

const builds = [
  {
    ...common,
    // The extension host (desktop and web worker alike) loads the entry
    // point with a CommonJS loader, so both bundles are CJS.
    format: "cjs",
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
  },
  {
    ...common,
    // The web extension host loads the tests path with a CommonJS loader,
    // so this bundle must be CJS too.
    format: "cjs",
    entryPoints: ["test/suite/index.ts"],
    outfile: "dist/test/index.js",
  },
];

if (watch) {
  const contexts = await Promise.all(
    builds.map((options) => esbuild.context(options)),
  );
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
