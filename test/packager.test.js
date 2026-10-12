import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import packager from "@turbowarp/packager";
import { build } from "../src/build.js";
import { TW_CONFIG_MAGIC } from "../src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("generated sb3 loads through the real TurboWarp project loader", async () => {
  const { sb3 } = build({ file: path.join(root, "examples/player.ms") });
  const loaded = await packager.loadProject(sb3);
  assert.ok(loaded);
  assert.equal(loaded.type, "sb3");
});

test("the loader recognises the stored _twconfig_ comment", async () => {
  const { sb3 } = build({ file: path.join(root, "examples/player.ms") });
  const loaded = await packager.loadProject(sb3);
  assert.ok(
    loaded.analysis.stageComments.some((text) =>
      text.includes(TW_CONFIG_MAGIC),
    ),
  );
});
