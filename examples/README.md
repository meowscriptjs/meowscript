# Examples

Small MeowScript projects that compile straight to a PenguinMod `.pmp`.
They depend on shared costumes in the repository's [`assets/`](../assets/)
directory and cannot be copied standalone. Each example has its own
`meowscript.yml`, so you can build one at a time from this repository:

```bash
ms build examples/player     # -> examples/player/build/meowscript-player.pmp
ms build examples/painter    # -> examples/painter/build/meowscript-painter.pmp
```

Then open the resulting `.pmp` in [PenguinMod](https://studio.penguinmod.com/)
and press the green flag.

| Example    | What it shows                                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player/`  | Sprites, costumes, `when` hats, `let` variables, `function` / `returning function` / `warp function`, boolean conditions, infix expressions, and the pen extension painting the ground. Hold `←` / `→` to walk, `space` to jump, and click the character. |
| `painter/` | The pen extension as a drawing tool: `forever` loops, mouse sensing, colour-parameter blocks, and a `setRotationStyle` dropdown. Move the mouse to draw, press `space` to clear the canvas.                                                               |

Both examples are compiled and loaded through the PenguinMod runtime by
`test/examples.test.js`, so they stay valid as the compiler evolves.

The exhaustive "every catalog block" project used to verify the whole compiler
surface lives in [`test/fixtures/all-blocks/`](../test/fixtures/all-blocks/),
next to the tests that use it.
