# 📦 MeowScript

> _Compile PenguinMod projects with a JS-like DSL._

## 🌟 Highlights

- **A JS-like DSL for Scratch.** Write `.ms` files that read like JavaScript and compile them to a real Scratch 3 / PenguinMod `.pmp` project.
- **Catalog-driven.** All 116 blocks (motion, looks, sound, sensing, operators, control, events, pen, plus PenguinMod extras) live in one data table — adding a block is a data change, not a code change.
- **Hats, functions and reporters.** `when greenFlag { … }`, custom `function` commands, and `returning function` reporters that map onto Scratch custom-block mutations.
- **Variables, lists and expressions.** `let` / `cloud let` / `list`, `=`/`+=`/`-=`/`*=`/`/=`, and full infix expressions with correct precedence (`+ - * / %`, comparisons, `and`/`or`/`not`).
- **Whole-project builds.** Point the compiler at a directory and every `.ms` file is merged into one project, sharing globals and the Stage.
- **PenguinMod settings.** `meowscript.yml` is emitted as a real config stage comment, so framerate / turbo / interpolation / stage size survive a round-trip through PenguinMod.
- **Extensions.** Load PenguinMod extensions from a path or URL, evaluate them in an isolated QuickJS runtime, and synthesize catalog entries for their blocks automatically — including extensions that only load unsandboxed, which are flagged so they can be allowed in the editor.
- **Round-trip friendly.** `decompile` turns a `.pmp` back into parseable `.ms`, using the same catalog as the compiler.
- **Project I/O.** A built-in ZIP reader/writer and asset helpers (md5 addressing, image/WAV headers). YAML parsing uses `js-yaml`; extension isolation uses `quickjs-emscripten`.

## ℹ️ Overview

MeowScript is a catalog-driven compiler for a small, JavaScript-shaped DSL. It reads `.ms` source into a token stream (`lexer.js`), parses it into a compact AST (`parser.js`) and lowers that AST into Scratch 3 project JSON (`compiler.js`), then zips `project.json` together with content-addressed assets into a `.pmp` (`sb3.js`) — PenguinMod's name for the same ZIP format as Scratch 3's `.sb3`. The output loads directly in PenguinMod.

The language is intentionally context-free and shape-driven: `sprite "…"`, `when <event>`, `let …`, `function …`, `return …` are recognized by their form rather than by reserved keywords. Every `category.block(...)` call is resolved through `catalog.js`, which the decompiler reads backwards, so the compiler and decompiler never drift apart.

### ✍️ Authors

> **AI Disclosure:** AI was used in the development of MeowScript.

> **Lead Developer:** [@kamixfox](https://github.com/kamixfox)

## 🚀 Usage

Scaffold and build in two commands:

```bash
ms init my-game        # creates meowscript.yml, src/main.ms and an example asset
cd my-game
ms build               # -> build/my-meowscript-project.pmp
```

A MeowScript source file example:

```js
// src/main.ms
sprite "Cat" {
    costumes: { cat: "../assets/cat.svg" };
    layer: 1;

    let score = 0;

    when greenFlag {
        motion.goToXY(0, 0);
        control.forever {
            motion.turnRight(1);
        }
    }

    when keyPressed("space") {
        score += 1;
        looks.sayForSecs(operators.join("Score: ", score), 1);
    }

    returning function label() {
        if (score > 10) { return "Pro"; } else { return "Rookie"; }
    }
}
```

### Command line

```
meowscript build [<input.ms>|<dir>] [-o <output.pmp>] [--no-config]   (alias: b)
meowscript decompile <input.pmp> [-o <output.ms>] [--assets <dir>]    (alias: d)
meowscript check [<input.ms>|<dir>]                                   (alias: c)
meowscript catalog [<dir>] [--json]                                   (alias: l)
meowscript init [dir]                                                 (alias: i)
```

`ms` is a shorthand for `meowscript` (so `ms b` builds and `ms c` checks). `build` defaults to the working directory and writes `build/<name>.pmp`; pass a `.ms` file to build just that one.

## 📖 Language reference

### Project structure

A project is any number of `.ms` files. `sprite "Name" { … }` declares a sprite; a `stage { … }` block declares the Stage; anything at the top level becomes Stage content. Sprite names must be unique, and only one `stage { }` may exist across all files.

Inside a target you can set `layer: <n>;`, list `costumes: { name: "path" };` and `sounds: { name: "path" };`. Asset paths are resolved relative to the file that references them, so `"../assets/cat.svg"` works from `src/`.

### Variables and lists

```js
let score = 0;              // sprite-local, or global on the Stage
cloud let highScore = 0;    // cloud variable (Stage/top level only)
list items = ["a", "b"];

score = 10;                 // set
score += 1;                 // change by
score -= 1;                 // set to (score - 1)
items.push("c");            // add
items.insert(1, "x");
items.replace(2, "y");
items.deleteAt(1);
items.deleteAll();
looks.say(items.itemAt(1));
```

### Hats and control flow

```js
when greenFlag { … }
when keyPressed("space") { … }
when spriteClicked { … }
when broadcast("start") { … }

if (score > 10) { … } else if (score > 5) { … } else { … }
repeat (10) { … }      // or repeat 10 { … }
while (score < 100) { … }
forever { … }
control.stop("all");
```

Hats are only needed for top-level scripts: the compiler rejects bare statements outside a `when`. Control blocks also accept the brace form (`control.forever { … }`).

A `forever` loop never ends, so statements written below one are still compiled — the
editor stacks them under the loop — but they never run.

### Functions

```js
function jump() { motion.changeY(40); }

function greet(name, loud: boolean) {
    if (loud) { looks.say(name); }
}

returning function level() {     // produces a value; requires `return`
    if (score > 100) { return "Pro"; }
    return "Rookie";
}

warp function draw() { … }       // runs without screen refresh
```

Parameters may be annotated `: boolean` (otherwise they are strings/numbers); `returning` and `warp` may be combined.

### Operators

Expressions support `+ - * / %`, `== != < <= > >=`, `and`/`&&`, `or`/`||`, `not`/`!`, unary `-`, grouping and array literals. All the Scratch operators are also available as blocks:

```js
operators.add(a, b);
operators.random(1, 6);
operators.join("x", y);
operators.math("sqrt", 9);
operators.letterOf(1, "abc");
```

### Blocks

Every other block is `category.block(...)`, for example:

```js
motion.moveSteps(10);
looks.switchCostume("idle");
sound.play("pop");
sensing.keyPressed("right arrow");
pen.setColor("#ff8800");
pm.lastKeyPressed();
pm.isPenguinMod();
```

Mixed blocks take their dropdowns first: `looks.setEffect("ghost", 25)`, `operators.math("sqrt", 9)`. Run `ms catalog` (or `ms catalog --json`) to list every available block and its opcode. It also discovers `meowscript.yml`, so blocks from extensions you list there — paths or URLs — appear alongside the built-ins (tagged `(ext <id>)`).

Ready-to-run demo projects live under `examples/` — `examples/player/` (a small platformer) and `examples/painter/` (a pen drawing pad). Build one with `ms build examples/player` and open the `.pmp` in PenguinMod. A project that exercises every built-in block at once, used to verify the whole compiler surface, lives at `test/fixtures/all-blocks/`.

## ⚙️ Configuration

`meowscript.yml` (or `.yaml`) is discovered by walking up from the source directory. All keys are optional:

```yaml
project:
  name: "My MeowScript Project"
  fps: 60 # framerate
  width: 480
  height: 360
  turbo: false
  interpolation: true
  hq: false
  runtime: {} # extra PenguinMod runtime options
  extensions:
    - "./extensions/signals.js"
    - "https://extensions.penguinmod.com/some/extension.js"
  unsandboxed: [signals] # extensions you allow to run unsandboxed (acknowledged)
```

Non-default settings are written into a Stage comment ending in `// _twconfig_` (PenguinMod's on-disk marker for stored project settings — the spelling is fixed by the runtime), exactly the format PenguinMod itself uses, so they round-trip. `--no-config` ignores the file entirely.

### Extensions

Extensions listed under `project.extensions` are evaluated in an isolated QuickJS WebAssembly runtime with no Node APIs, filesystem or network access. Source execution, `getInfo()` and metadata serialization share a five-second limit and a 64 MiB memory limit. Their blocks become catalog entries, so `signals.send("hi")` compiles to the `signals_send` opcode. Browser helpers such as `URL` and `TextEncoder` are inert metadata stubs. Remote `http(s)://` extensions are also recorded in `project.extensionURLs`. Local files raise a warning about bundling/hosting since the editor cannot load them from disk. PenguinMod's gallery lives at [extensions.penguinmod.com](https://extensions.penguinmod.com/).

#### Unsandboxed extensions

Many gallery extensions refuse to load unless they run _unsandboxed_ (`if (!Scratch.extensions.unsandboxed) throw …`). Whether an extension actually runs sandboxed is decided by the editor (or the packager) when the project is opened, so the compiler never blocks them: it retries those extensions with an unsandboxed `Scratch` API and catalogs their blocks. The sandbox also tolerates the VM and browser globals such extensions touch at module scope (a permissive `Scratch.vm`/`renderer`, `document`, `navigator`, `Audio`, …) — it only reads `getInfo()`, so none of it has to work. They are then reported so they don't surprise you at runtime — `ms build` prints an `unsandboxed:` line and a warning telling you to **allow the extension to run unsandboxed** when opening the project (leaving it in the sandbox makes it error out on load).

Once you trust an extension, declare its id under `project.unsandboxed` to acknowledge it. That silences the warning, and MeowScript warns you back if a declared entry actually loads sandboxed or matches no extension:

```yaml
project:
  extensions:
    - "https://extensions.penguinmod.com/some/extension.js"
  unsandboxed:
    - someExtensionId
```

Extensions served from `https://extensions.penguinmod.com/` (and the other origins the editor trusts) load automatically and unsandboxed without a prompt; third-party URLs always ask.

## ⬇️ Installation

MeowScript requires **Node.js 22 or newer**.

```bash
npm install -g @meowscriptjs/meowscript
```

This provides both the `meowscript` and `ms` commands. Or add it to a project:

```bash
npm install @meowscriptjs/meowscript
```

Then use the programmatic API shown above, the subpath export `@meowscriptjs/meowscript/catalog` for the raw block catalog, or `@meowscriptjs/meowscript/language` for the browser-safe lexer/parser/error/catalog modules (no Node built-ins — safe to bundle for the web).

_For contributors:_ `npm install` then `npm test` (Node's built-in test runner). `npm run build:example` compiles `examples/player/` to `build/player.pmp`. Run `npm run lint` (ESLint) and `npm run format` (Prettier; `npm run format:check` in CI) to keep the tree clean.

## 💭 Feedback and Contributing

Bug reports and feature requests are welcome — please open an issue on the repository. When reporting a compile error, include the `.ms` source and the full diagnostic, which points at the exact file, line and column.

Contributions are welcome too: the easiest places to start are adding catalog entries in `src/catalog.js`, extending the language in `src/parser.js`, or adding fixtures under `test/`.

## 📄 License

Apache-2.0 — see [LICENSE](LICENSE).
