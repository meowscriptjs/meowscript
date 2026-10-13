/**
 * MeowScript compiler: AST -> Scratch 3 / PenguinMod project JSON.
 *
 * The compiler is deliberately catalog-driven: every `category.block(...)` is
 * resolved through `catalog.js`, so adding a new block is a data change rather
 * than a code change.
 */
import { CATALOG, LIST_OPS, extensionForOpcode } from "./catalog.js";
import { CompileError } from "./errors.js";
import { configComment } from "./config.js";
import { md5hex, imageSize, wavInfo, detectFormat } from "./sb3.js";

const HAT_ALIASES = {
  greenFlag: "events.greenFlag",
  keyPressed: "events.keyPressed",
  spriteClicked: "events.spriteClicked",
  thisSpriteClicked: "events.spriteClicked",
  stageClicked: "events.stageClicked",
  cloneStart: "events.cloneStart",
  startAsClone: "events.cloneStart",
  broadcast: "events.broadcastReceived",
  broadcastReceived: "events.broadcastReceived",
  backdropSwitchesTo: "events.backdropSwitchesTo",
  loudnessGreaterThan: "events.loudnessGreaterThan",
  timerGreaterThan: "events.timerGreaterThan",
};

const NUMBER_TYPES = {
  number: 4,
  positive: 5,
  whole: 6,
  integer: 7,
};

// Opcodes whose block ends the stack: scratch-blocks gives them "shape_end"
// (no next-statement connection), so nothing can be serialized below them. The
// editor dereferences that missing connection while reading a following
// `<next>` element, which aborts the whole workspace update — so the compiler
// must refuse to emit statements after one.
const TERMINAL_OPCODES = new Set([
  "procedures_return",
  "control_delete_this_clone",
]);

let seed = 0;
function uid(prefix = "b") {
  seed = (seed + 1) % 0xffffff;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16);
  return `${prefix}${seed.toString(16)}${rand}`.slice(0, 20);
}

/** @param {unknown} value */
function normalizeColor(value) {
  const s = String(value).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s))
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return "#000000";
}

function blankSvg(width, height, fill = false) {
  const rect = fill
    ? `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rect}</svg>`;
}

class Context {
  constructor(compiler, target, isStage) {
    this.compiler = compiler;
    this.target = target;
    this.isStage = isStage;
    this.vars = new Map();
    this.lists = new Map();
    this.funcs = new Map();
    this.paramScopes = [];
    this.scriptX = 48;
    this.scriptY = 48;
  }

  nextScriptPosition() {
    const x = this.scriptX;
    const y = this.scriptY;
    this.scriptY += 420;
    if (this.scriptY > 3600) {
      this.scriptY = 48;
      this.scriptX += 500;
    }
    return { x, y };
  }

  resolveValue(name) {
    for (let i = this.paramScopes.length - 1; i >= 0; i--) {
      const scope = this.paramScopes[i];
      if (scope.has(name)) return { kind: "param", param: scope.get(name) };
    }
    if (this.vars.has(name)) return { kind: "var", ...this.vars.get(name) };
    if (this.lists.has(name)) return { kind: "list", ...this.lists.get(name) };
    const global = this.compiler.globals.get(name);
    if (global) return { kind: global.kind, ...global };
    return null;
  }

  resolveList(name) {
    if (this.lists.has(name)) return this.lists.get(name);
    const global = this.compiler.globals.get(name);
    if (global && global.kind === "list") return global;
    return null;
  }
}

export class Compiler {
  /**
   * @param {object} options
   * @param {object} options.project normalized meowscript.yml project config
   * @param {(p: string) => Buffer} [options.loadAsset]
   * @param {Record<string, object>} [options.catalog] extra/overriding catalog entries
   * @param {Record<string, string>} [options.extensionUrls] id -> URL
   * @param {string} [options.file]
   */
  constructor({
    project,
    loadAsset,
    catalog,
    extensionUrls = {},
    file = "<input>",
  } = {}) {
    this.projectConfig = project || {};
    this.loadAsset = loadAsset || null;
    this.catalog = catalog ? { ...CATALOG, ...catalog } : CATALOG;
    this.extensionUrls = extensionUrls;
    this.file = file;

    // opcode -> extension id, derived from the (merged) catalog. This lets
    // synthesized extension blocks declare an id that isn't inferable from
    // the opcode prefix alone.
    this.opcodeExtensions = new Map();
    for (const entry of Object.values(this.catalog)) {
      if (entry && entry.extension && entry.opcode)
        this.opcodeExtensions.set(entry.opcode, entry.extension);
    }

    // Opcodes whose next-statement connection only exists once a mutation asks
    // for it (PenguinMod's loop nub), derived from the merged catalog.
    this.dynamicNextOpcodes = new Set();
    for (const entry of Object.values(this.catalog)) {
      if (entry && entry.dynamicNext && entry.opcode)
        this.dynamicNextOpcodes.add(entry.opcode);
    }

    this.assets = new Map(); // md5ext -> Buffer
    this.globals = new Map(); // name -> {kind:'var'|'list', id, name, cloud?, value?}
    this.broadcasts = new Map(); // name -> id
    this.varCounter = 0;
    this.broadcastCounter = 0;

    /** @type {Context|null} */
    this.ctx = null;
  }

  // ------------------------------------------------------------- utilities

  fail(message, loc) {
    throw new CompileError(message, {
      file: (loc && loc.file) || this.file,
      line: loc && loc.line,
      column: loc && loc.column,
    });
  }

  newVarId() {
    return `v${(++this.varCounter).toString(36)}`;
  }

  registerAsset(buffer, format) {
    const assetId = md5hex(buffer);
    const md5ext = `${assetId}.${format}`;
    if (!this.assets.has(md5ext)) this.assets.set(md5ext, buffer);
    return { assetId, md5ext, dataFormat: format };
  }

  declareGlobal(kind, name, extra = {}) {
    const id = this.newVarId();
    const info = { kind, id, name, ...extra };
    this.globals.set(name, info);
    return info;
  }

  broadcast(name) {
    const clean = String(name);
    if (!this.broadcasts.has(clean)) {
      this.broadcasts.set(clean, uid("bc"));
    }
    return this.broadcasts.get(clean);
  }

  // --------------------------------------------------------------- entry

  /**
   * @param {object} ast Program node
   * @returns {{project: object, assets: Map<string, Buffer>}}
   */
  compile(ast) {
    const stageDecl = ast.stage;
    const stageItems = [...(stageDecl ? stageDecl.body : []), ...ast.topItems];

    this.stageContext = new Context(this, this.makeTarget(null, true), true);

    const contexts = [];
    this.stageCtx = this.buildTargetContext(
      this.stageContext,
      stageItems,
      "Stage",
    );
    contexts.push(this.stageCtx);

    for (const sprite of ast.sprites) {
      const target = this.makeTarget(sprite.name, false);
      const ctx = this.buildTargetContext(
        new Context(this, target, false),
        sprite.body,
        sprite.name,
      );
      ctx.sprite = sprite;
      contexts.push(ctx);
    }

    // Pass 2: emit scripts (hats + function bodies).
    for (const ctx of contexts) {
      this.ctx = ctx;
      this.emitTargetScripts(ctx);
    }

    // Pass 3: editor-only connection state. "Next" links are wired up as the
    // stacks are emitted, so blocks whose next-statement connection is dynamic
    // can only be given their mutation once every stack is complete.
    for (const ctx of contexts) this.applyDynamicNextMutations(ctx);

    return { project: this.assembleProject(contexts), assets: this.assets };
  }

  /**
   * Give every block with a dynamic next-statement connection the mutation the
   * editor itself stores for it.
   *
   * PenguinMod's `control_forever` starts out without a next-statement
   * connection: `Blockly.Blocks.control_forever.init` calls
   * `setNextStatement(false)`, and only `domToMutation` (fed by
   * `<mutation hasbreak="true">`, the nub the editor adds once a block sits
   * below the loop) calls `setNextStatement(true, 'normal')`. A loop with
   * blocks stacked under it but no such mutation makes the editor read
   * `nextConnection.isConnected()` on null while handling the following
   * `<next>` element, which aborts the entire workspace update.
   * @param {Context} ctx
   */
  applyDynamicNextMutations(ctx) {
    if (this.dynamicNextOpcodes.size === 0) return;
    for (const block of Object.values(ctx.target.blocks)) {
      if (!this.dynamicNextOpcodes.has(block.opcode)) continue;
      block.mutation = {
        tagName: "mutation",
        hasbreak: Boolean(block.next),
        children: [],
      };
    }
  }

  makeTarget(name, isStage) {
    return {
      isStage,
      name: isStage ? "Stage" : name,
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: 0,
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: "all around",
    };
  }

  buildTargetContext(ctx, items, targetName) {
    ctx.bodyItems = items;
    ctx.targetName = targetName;
    // ---- pass 1: declarations (hoisted) ------------------------------
    for (const item of items) {
      if (item.type === "PropertyDecl") continue;
      if (item.type === "VarDecl") {
        this.declareTargetVar(ctx, item);
      } else if (item.type === "ListDecl") {
        this.declareTargetList(ctx, item);
      } else if (item.type === "FunctionDecl") {
        this.declareFunction(ctx, item);
      }
    }

    // ---- costumes / sounds / layer -----------------------------------
    for (const item of items) {
      if (item.type !== "PropertyDecl") continue;
      if (item.key === "costumes") this.applyCostumes(ctx, item);
      else if (item.key === "sounds") this.applySounds(ctx, item);
      else if (item.key === "layer") {
        const value =
          item.value && item.value.type === "Number" ? item.value.value : 0;
        ctx.target.layerOrder = value;
      }
    }

    return ctx;
  }

  declareTargetVar(ctx, decl) {
    const global = ctx.isStage;
    if (global && this.globals.has(decl.name)) {
      this.fail(
        `Duplicate global variable ${JSON.stringify(decl.name)}`,
        decl.loc,
      );
    }
    if (!global && ctx.vars.has(decl.name)) {
      this.fail(
        `Duplicate variable ${JSON.stringify(decl.name)} in ${ctx.targetName}`,
        decl.loc,
      );
    }
    let value = 0;
    if (decl.init) value = this.constValue(decl.init, ctx);
    const info = {
      kind: "var",
      id: this.newVarId(),
      name: decl.name,
      cloud: !!decl.cloud,
      value,
    };
    if (global) {
      this.globals.set(decl.name, info);
    } else {
      if (decl.cloud)
        this.fail(
          "`cloud let` is only valid at the top level or inside `stage`",
          decl.loc,
        );
      ctx.vars.set(decl.name, info);
    }
    ctx.target.variables[info.id] = info.cloud
      ? [decl.name, value, true]
      : [decl.name, value];
  }

  declareTargetList(ctx, decl) {
    if (ctx.isStage && this.globals.has(decl.name)) {
      this.fail(
        `Duplicate global variable ${JSON.stringify(decl.name)}`,
        decl.loc,
      );
    }
    if (!ctx.isStage && ctx.lists.has(decl.name)) {
      this.fail(
        `Duplicate list ${JSON.stringify(decl.name)} in ${ctx.targetName}`,
        decl.loc,
      );
    }
    const items = decl.items.map((expr) => String(this.constValue(expr, ctx)));
    const info = {
      kind: "list",
      id: this.newVarId(),
      name: decl.name,
      value: items,
    };
    if (ctx.isStage) this.globals.set(decl.name, info);
    else ctx.lists.set(decl.name, info);
    ctx.target.lists[info.id] = [decl.name, items];
  }

  declareFunction(ctx, decl) {
    if (ctx.funcs.has(decl.name)) {
      this.fail(
        `Duplicate function ${JSON.stringify(decl.name)} in ${ctx.targetName}`,
        decl.loc,
      );
    }
    const argIds = decl.params.map((_, i) => `arg${i}`);
    const proccode = decl.params.length
      ? `${decl.name} ${decl.params.map(() => "%s").join(" ")}`
      : decl.name;
    ctx.funcs.set(decl.name, {
      name: decl.name,
      params: decl.params,
      argIds,
      proccode,
      returns: decl.returns,
      warp: !!decl.warp,
      decl,
      definitionId: null,
    });
  }

  constValue(expr, ctx) {
    if (!expr) return 0;
    switch (expr.type) {
      case "Number":
        return expr.value;
      case "String":
        return expr.value;
      case "Boolean":
        return expr.value;
      case "Identifier": {
        const resolved = ctx
          ? ctx.resolveValue(expr.name)
          : this.globals.get(expr.name);
        if (resolved && resolved.kind === "var") {
          const raw = resolved.value ?? this.globals.get(expr.name)?.value;
          return raw === undefined ? 0 : raw;
        }
        return 0;
      }
      case "Unary":
        if (expr.op === "-") return -Number(this.constValue(expr.operand, ctx));
        return 0;
      default:
        return 0;
    }
  }

  // ----------------------------------------------------------- assets

  applyCostumes(ctx, property) {
    for (const entry of property.value) {
      const format = detectFormat(entry.value);
      const buffer = this.readAsset(entry.value, entry.loc);
      const { width, height } = imageSize(buffer, format);
      const asset = this.registerAsset(buffer, format);
      ctx.target.costumes.push({
        name: entry.key,
        bitmapResolution: 1,
        dataFormat: format,
        assetId: asset.assetId,
        md5ext: asset.md5ext,
        rotationCenterX: width / 2,
        rotationCenterY: height / 2,
      });
    }
  }

  applySounds(ctx, property) {
    for (const entry of property.value) {
      const format = detectFormat(entry.value);
      const buffer = this.readAsset(entry.value, entry.loc);
      const info =
        format === "wav" ? wavInfo(buffer) : { rate: 48000, sampleCount: 0 };
      const asset = this.registerAsset(buffer, format);
      ctx.target.sounds.push({
        name: entry.key,
        assetId: asset.assetId,
        dataFormat: format,
        format: "",
        rate: info.rate,
        sampleCount: info.sampleCount,
        md5ext: asset.md5ext,
      });
    }
  }

  readAsset(filePath, loc) {
    if (!this.loadAsset)
      this.fail(
        `Cannot load asset ${JSON.stringify(filePath)}: no asset loader configured`,
        loc,
      );
    try {
      return this.loadAsset(filePath, loc);
    } catch (err) {
      this.fail(
        `Unable to read asset ${JSON.stringify(filePath)}: ${err.message}`,
        loc,
      );
    }
  }

  // ------------------------------------------------------------- pass 2

  emitTargetScripts(ctx) {
    const previous = this.ctx;
    this.ctx = ctx;
    const body = ctx.bodyItems;
    for (const item of body) {
      if (item.type === "HatDecl") {
        this.emitHat(ctx, item);
      } else if (item.type === "FunctionDecl") {
        this.emitFunction(ctx, item);
      } else if (
        item.type === "PropertyDecl" ||
        item.type === "VarDecl" ||
        item.type === "ListDecl"
      ) {
        // handled in pass 1
      } else {
        this.fail(
          "Statements must appear inside a `when ... { }` hat block",
          item.loc,
        );
      }
    }
    this.ctx = previous;
  }

  emitHat(ctx, decl) {
    const short = decl.event.segments[decl.event.segments.length - 1];
    // Prefer the fully qualified name so extensions can expose hats such as
    // `signals.onMessage`; otherwise fall back to the built-in aliases.
    const fullyQualified = this.catalog[decl.event.name];
    const canonical = HAT_ALIASES[short] || `events.${short}`;
    const entry =
      fullyQualified && fullyQualified.kind === "hat"
        ? fullyQualified
        : this.catalog[canonical];
    if (!entry || entry.kind !== "hat")
      this.fail(`Unknown event ${JSON.stringify(short)}`, decl.loc);

    const pos = ctx.nextScriptPosition();
    const fields = {};
    const inputs = {};
    const argSpecs = entry.args || [];
    if (decl.event.args.length > argSpecs.length) {
      this.fail(
        `Event ${short} accepts at most ${argSpecs.length} argument(s)`,
        decl.loc,
      );
    }
    argSpecs.forEach((spec, i) => {
      const argExpr = decl.event.args[i];
      if (spec.field) {
        if (spec.type === "broadcast") {
          const name = argExpr
            ? String(this.literalValue(argExpr))
            : spec.default;
          fields[spec.field] = [name, this.broadcast(name)];
        } else {
          const value = argExpr ? this.literalValue(argExpr) : spec.default;
          fields[spec.field] = [String(value ?? spec.value ?? "")];
        }
      } else if (spec.input) {
        inputs[spec.input] = this.buildInputForSpec(
          { type: spec.type || "any" },
          argExpr,
          null,
        );
      }
    });

    const id = this.addBlock(ctx, {
      opcode: entry.opcode,
      fields,
      inputs,
      topLevel: true,
      x: pos.x,
      y: pos.y,
    });
    // re-parent any inputs that referenced this hat
    this.reparentInputs(ctx, id, inputs);
    const first = this.newStack(ctx, decl.body, id);
    if (first) ctx.target.blocks[id].next = first;
    return id;
  }

  emitFunction(ctx, decl) {
    const fn = ctx.funcs.get(decl.name);
    const pos = ctx.nextScriptPosition();
    const defId = this.addBlock(ctx, {
      opcode: fn.returns
        ? "procedures_definition_return"
        : "procedures_definition",
      topLevel: true,
      x: pos.x,
      y: pos.y,
    });

    const protoId = uid("proto");
    const protoInputs = {};
    for (let i = 0; i < fn.params.length; i++) {
      const param = fn.params[i];
      const repId = this.addBlock(ctx, {
        opcode: param.boolean
          ? "argument_reporter_boolean"
          : "argument_reporter_string_number",
        shadow: true,
        parent: protoId,
        fields: { VALUE: [param.name, null] },
      });
      protoInputs[fn.argIds[i]] = [1, repId];
    }
    ctx.target.blocks[protoId] = {
      opcode: "procedures_prototype",
      next: null,
      parent: defId,
      inputs: protoInputs,
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: "mutation",
        children: [],
        proccode: fn.proccode,
        argumentids: JSON.stringify(fn.argIds),
        argumentnames: JSON.stringify(fn.params.map((p) => p.name)),
        argumentdefaults: JSON.stringify(fn.params.map(() => "")),
        warp: String(fn.warp),
        ...(fn.returns ? { returns: "true" } : {}),
      },
    };
    ctx.target.blocks[defId].inputs.custom_block = [1, protoId];
    fn.definitionId = defId;

    // Compile body with parameters in scope.
    const scope = new Map();
    for (const param of fn.params) scope.set(param.name, param);
    ctx.paramScopes.push(scope);
    const first = this.newStack(ctx, decl.body, defId);
    ctx.paramScopes.pop();
    if (first) ctx.target.blocks[defId].next = first;
  }

  // --------------------------------------------------------- block utils

  reparentInputs(ctx, parentId, inputs) {
    for (const value of Object.values(inputs)) {
      if (!Array.isArray(value)) continue;
      for (let i = 1; i < value.length; i++) {
        const ref = value[i];
        if (typeof ref === "string" && ctx.target.blocks[ref]) {
          ctx.target.blocks[ref].parent = parentId;
        }
      }
    }
  }

  addBlock(ctx, opts) {
    const id = uid();
    const block = {
      opcode: opts.opcode,
      next: opts.next || null,
      parent: opts.parent || null,
      inputs: opts.inputs || {},
      fields: opts.fields || {},
      shadow: !!opts.shadow,
      topLevel: !!opts.topLevel,
    };
    if (opts.topLevel) {
      block.x = opts.x || 0;
      block.y = opts.y || 0;
    }
    if (opts.mutation) block.mutation = opts.mutation;
    ctx.target.blocks[id] = block;
    return id;
  }

  newStack(ctx, statements, parentId) {
    let first = null;
    let prev = null;
    for (const statement of statements) {
      if (prev != null && this.blockEndsScript(ctx, prev)) {
        this.fail(
          `No statements can follow ${this.terminalDescription(ctx, prev)}; ` +
            "nothing can connect below a block that ends the script",
          statement.loc,
        );
      }
      const id = this.compileStatement(ctx, statement);
      if (id == null) continue;
      if (first == null) {
        first = id;
        ctx.target.blocks[id].parent = parentId;
      } else {
        ctx.target.blocks[prev].next = id;
        ctx.target.blocks[id].parent = prev;
      }
      prev = id;
    }
    return first;
  }

  /**
   * Whether a compiled block has no next-statement connection in the editor.
   * `control.forever` is excluded: PenguinMod grows a next connection for it
   * via its `hasbreak` mutation (see `dynamicNext`).
   * @param {Context} ctx
   * @param {string} id
   */
  blockEndsScript(ctx, id) {
    const block = ctx.target.blocks[id];
    if (!block) return false;
    if (TERMINAL_OPCODES.has(block.opcode)) return true;
    if (block.opcode === "control_stop") {
      return !(block.mutation && block.mutation.hasnext);
    }
    return false;
  }

  /** Human-readable name for a block that ends the script. */
  terminalDescription(ctx, id) {
    const block = ctx.target.blocks[id];
    if (block.opcode === "procedures_return") return "`return`";
    if (block.opcode === "control_delete_this_clone")
      return "`control.deleteThisClone()`";
    if (block.opcode === "control_stop") {
      const option = block.fields.STOP_OPTION
        ? block.fields.STOP_OPTION[0]
        : "all";
      return `\`control.stop(${JSON.stringify(option)})\``;
    }
    return `\`${block.opcode}\``;
  }

  // ------------------------------------------------------- statements

  compileStatement(ctx, node) {
    switch (node.type) {
      case "BlockCall":
        return this.compileBlockCallStatement(ctx, node);
      case "Assign":
        return this.compileAssign(ctx, node);
      case "If":
        return this.compileIf(ctx, node);
      case "Repeat":
        return this.compileRepeat(ctx, node);
      case "While":
        return this.compileWhile(ctx, node);
      case "Forever":
        return this.compileForever(ctx, node);
      case "Return":
        return this.compileReturn(ctx, node);
      default:
        this.fail(`Unsupported statement ${node.type}`, node.loc);
    }
    return null;
  }

  compileBlockCallStatement(ctx, node) {
    const result = this.emitCall(ctx, node, null);
    if (result.kind === "reporter" || result.kind === "boolean") {
      this.fail(
        `${node.name} returns a value and cannot be used as a statement`,
        node.loc,
      );
    }
    if (node.body) {
      const entry = result.entry;
      const subNames = entry
        ? Object.keys(entry.inputs || {}).filter(
            (key) => entry.inputs[key].type === "substack",
          )
        : [];
      if (!subNames.length)
        this.fail(`${node.name} cannot take a block body`, node.loc);
      const first = this.newStack(ctx, node.body, result.id);
      if (first) ctx.target.blocks[result.id].inputs[subNames[0]] = [2, first];
      if (node.else) {
        if (subNames[1]) {
          const firstElse = this.newStack(ctx, node.else, result.id);
          if (firstElse)
            ctx.target.blocks[result.id].inputs[subNames[1]] = [2, firstElse];
        } else {
          this.fail(`${node.name} does not support an else branch`, node.loc);
        }
      }
    }
    return result.id;
  }

  compileAssign(ctx, node) {
    const resolved = ctx.resolveValue(node.name);
    if (!resolved || resolved.kind !== "var") {
      this.fail(`Unknown variable ${JSON.stringify(node.name)}`, node.loc);
    }
    const variableField = [resolved.name, resolved.id];
    if (node.op === "=") {
      const id = this.addBlock(ctx, {
        opcode: "data_setvariableto",
        fields: { VARIABLE: variableField },
      });
      ctx.target.blocks[id].inputs.VALUE = this.buildInputForSpec(
        { type: "any" },
        node.value,
        id,
      );
      return id;
    }
    if (node.op === "+=") {
      const id = this.addBlock(ctx, {
        opcode: "data_changevariableby",
        fields: { VARIABLE: variableField },
      });
      ctx.target.blocks[id].inputs.VALUE = this.buildInputForSpec(
        { type: "any" },
        node.value,
        id,
      );
      return id;
    }
    // -=, *=, /= become `set x = <op>(x, value)`
    const opMap = {
      "-=": "operators.subtract",
      "*=": "operators.multiply",
      "/=": "operators.divide",
    };
    const id = this.addBlock(ctx, {
      opcode: "data_setvariableto",
      fields: { VARIABLE: variableField },
    });
    const opName = opMap[node.op];
    const operatorId = this.emitBinaryBlock(
      ctx,
      opName,
      id,
      {
        type: "Identifier",
        name: node.name,
        segments: [node.name],
        loc: node.loc,
      },
      node.value,
    );
    ctx.target.blocks[id].inputs.VALUE = [3, operatorId, [10, ""]];
    return id;
  }

  compileIf(ctx, node) {
    const id = this.addBlock(ctx, {
      opcode: node.else ? "control_if_else" : "control_if",
    });
    ctx.target.blocks[id].inputs.CONDITION = this.booleanInput(
      ctx,
      node.cond,
      id,
    );
    const first = this.newStack(ctx, node.then, id);
    if (first) ctx.target.blocks[id].inputs.SUBSTACK = [2, first];
    if (node.else) {
      const firstElse = this.newStack(ctx, node.else, id);
      if (firstElse) ctx.target.blocks[id].inputs.SUBSTACK2 = [2, firstElse];
    }
    return id;
  }

  compileRepeat(ctx, node) {
    const id = this.addBlock(ctx, { opcode: "control_repeat" });
    ctx.target.blocks[id].inputs.TIMES = this.buildInputForSpec(
      { type: "whole" },
      node.count,
      id,
    );
    const first = this.newStack(ctx, node.body, id);
    if (first) ctx.target.blocks[id].inputs.SUBSTACK = [2, first];
    return id;
  }

  compileWhile(ctx, node) {
    const id = this.addBlock(ctx, { opcode: "control_repeat_until" });
    // while (cond) == repeat until (not cond)
    const notId = this.addBlock(ctx, { opcode: "operator_not", parent: id });
    ctx.target.blocks[notId].inputs.OPERAND = this.booleanInput(
      ctx,
      node.cond,
      notId,
    );
    ctx.target.blocks[id].inputs.CONDITION = [2, notId];
    const first = this.newStack(ctx, node.body, id);
    if (first) ctx.target.blocks[id].inputs.SUBSTACK = [2, first];
    return id;
  }

  compileForever(ctx, node) {
    const id = this.addBlock(ctx, { opcode: "control_forever" });
    const first = this.newStack(ctx, node.body, id);
    if (first) ctx.target.blocks[id].inputs.SUBSTACK = [2, first];
    return id;
  }

  compileReturn(ctx, node) {
    const id = this.addBlock(ctx, { opcode: "procedures_return" });
    ctx.target.blocks[id].inputs.return = node.value
      ? this.buildInputForSpec({ type: "any" }, node.value, id)
      : [1, [10, ""]];
    return id;
  }

  // -------------------------------------------------------- call dispatch

  /**
   * Emit a call node. Returns {id, kind, entry?}.
   */
  emitCall(ctx, node, parentId) {
    const segments = node.segments;

    // List method: `items.push(x)`, `items.at(i)`, ...
    if (segments.length === 2) {
      const listInfo = ctx.resolveList(segments[0]);
      if (listInfo) return this.emitListCall(ctx, node, listInfo, parentId);
    }

    const entry = this.catalog[node.name];
    if (entry) return this.emitCatalogCall(ctx, node, entry, parentId);

    if (segments.length === 1 && ctx.funcs.has(node.name)) {
      return this.emitProcedureCall(
        ctx,
        node,
        ctx.funcs.get(node.name),
        parentId,
      );
    }

    this.fail(
      `Unknown block or function ${JSON.stringify(node.name)}`,
      node.loc,
    );
    return null;
  }

  emitCatalogCall(ctx, node, entry, parentId) {
    if (entry.kind === "hat")
      this.fail(`${node.name} is an event and cannot be called`, node.loc);
    const id = this.addBlock(ctx, { opcode: entry.opcode, parent: parentId });
    const fieldNames = Object.keys(entry.fields || {});
    const inputNames = Object.keys(entry.inputs || {});

    if (node.args.length > inputNames.length + fieldNames.length) {
      this.fail(
        `${node.name} expects at most ${inputNames.length + fieldNames.length} argument(s)`,
        node.loc,
      );
    }

    const fields = {};
    for (const [name, value] of Object.entries(entry.fields || {})) {
      fields[name] = Array.isArray(value) ? value : [String(value)];
    }

    // Positional args fill dropdown fields first, then value inputs. This
    // mirrors how mixed blocks read left-to-right in the editor, e.g.
    // `looks.setEffect("ghost", 25)` or `operators.math("sqrt", 9)`.
    const inputs = {};
    let argIndex = 0;
    for (const name of fieldNames) {
      if (node.args[argIndex] !== undefined) {
        fields[name] = [String(this.literalValue(node.args[argIndex]))];
        argIndex += 1;
      }
    }
    for (const name of inputNames) {
      const spec = entry.inputs[name];
      if (spec.type === "substack") continue;
      if (node.args[argIndex] !== undefined) {
        inputs[name] = this.buildInputForSpec(spec, node.args[argIndex], id);
        argIndex += 1;
      } else {
        inputs[name] = this.defaultInput(spec);
      }
    }

    ctx.target.blocks[id].inputs = inputs;
    ctx.target.blocks[id].fields = fields;
    this.reparentInputs(ctx, id, inputs);

    if (entry.stopBlock) {
      const stopOption = fields.STOP_OPTION ? fields.STOP_OPTION[0] : "all";
      const hasNext =
        stopOption === "other scripts in sprite" ||
        stopOption === "other scripts in stage";
      ctx.target.blocks[id].mutation = {
        tagName: "mutation",
        hasnext: hasNext,
        children: [],
      };
    }

    return { id, kind: entry.kind, entry };
  }

  emitListCall(ctx, node, listInfo, parentId) {
    const method = node.segments[1];
    let spec = null;
    let canonical = method;
    for (const [name, entry] of Object.entries(LIST_OPS)) {
      if (name === method || (entry.aliases || []).includes(method)) {
        spec = entry;
        canonical = name;
        break;
      }
    }
    if (!spec)
      this.fail(
        `Unknown list operation ${JSON.stringify(method)} on list ${JSON.stringify(listInfo.name)}`,
        node.loc,
      );

    const fields = { LIST: [listInfo.name, listInfo.id] };
    const id = this.addBlock(ctx, {
      opcode: spec.opcode,
      fields,
      parent: parentId,
    });
    spec.inputs.forEach((inputName, i) => {
      if (node.args[i] === undefined) {
        ctx.target.blocks[id].inputs[inputName] = [1, [4, "0"]];
      } else {
        const specType =
          inputName === "INDEX" ? { type: "whole" } : { type: "any" };
        ctx.target.blocks[id].inputs[inputName] = this.buildInputForSpec(
          specType,
          node.args[i],
          id,
        );
      }
    });
    this.reparentInputs(ctx, id, ctx.target.blocks[id].inputs);
    void canonical;
    return { id, kind: spec.kind, entry: spec };
  }

  emitProcedureCall(ctx, node, fn, parentId) {
    const id = this.addBlock(ctx, {
      opcode: "procedures_call",
      parent: parentId,
    });
    const inputs = {};
    fn.argIds.forEach((argId, i) => {
      const param = fn.params[i];
      const spec = param.boolean ? { type: "boolean" } : { type: "any" };
      inputs[argId] =
        node.args[i] !== undefined
          ? this.buildInputForSpec(spec, node.args[i], id)
          : this.defaultInput(spec);
    });
    const mutation = {
      tagName: "mutation",
      children: [],
      proccode: fn.proccode,
      argumentids: JSON.stringify(fn.argIds),
      warp: String(fn.warp),
    };
    if (fn.returns) mutation.returns = "true";
    ctx.target.blocks[id].mutation = mutation;
    ctx.target.blocks[id].inputs = inputs;
    this.reparentInputs(ctx, id, inputs);
    return { id, kind: fn.returns ? "reporter" : "command", entry: {} };
  }

  // ------------------------------------------------------- input builders

  buildInputForSpec(spec, expr, parentId) {
    if (expr === undefined || expr === null) return this.defaultInput(spec);
    if (spec.type === "menu") return this.menuInput(spec, expr, parentId);
    if (spec.type === "broadcast") return this.broadcastInput(expr, parentId);
    if (spec.type === "boolean")
      return this.booleanInput(this.ctx, expr, parentId);
    const desc = this.emitExpr(this.ctx, expr);
    return this.valueInput(desc, spec, parentId);
  }

  defaultInput(spec) {
    if (spec.type === "boolean")
      return [2, this.booleanLiteralBlock(this.ctx, true)];
    if (spec.type === "menu") {
      const value = spec.default ?? "";
      const id = this.addBlock(this.ctx, {
        opcode: spec.menu,
        shadow: true,
        fields: { [spec.field]: [String(value)] },
      });
      return [1, id];
    }
    return [1, this.defaultPrim(spec)];
  }

  defaultPrim(spec) {
    switch (spec.type) {
      case "number":
        return [4, "0"];
      case "positive":
        return [5, "0"];
      case "whole":
        return [6, "0"];
      case "integer":
        return [7, "0"];
      case "angle":
        return [8, "90"];
      case "color":
        return [9, "#000000"];
      case "string":
        return [10, ""];
      default:
        return [10, ""];
    }
  }

  menuInput(spec, expr, parentId) {
    const value = this.literalValue(expr);
    const id = this.addBlock(this.ctx, {
      opcode: spec.menu,
      shadow: true,
      parent: parentId,
      fields: { [spec.field]: [String(value ?? spec.default ?? "")] },
    });
    return [1, id];
  }

  broadcastInput(expr, parentId) {
    const name = String(this.literalValue(expr));
    const id = this.broadcast(name);
    void parentId;
    return [1, [11, name, id]];
  }

  booleanInput(ctx, expr, parentId) {
    const desc = this.emitExpr(ctx, expr);
    if (desc.k === "block") {
      ctx.target.blocks[desc.id].parent = parentId;
      return [2, desc.id];
    }
    // Literal/primitive in boolean position: compare against "true".
    const id = this.addBlock(ctx, {
      opcode: "operator_equals",
      parent: parentId,
    });
    ctx.target.blocks[id].inputs.OPERAND1 = [
      1,
      desc.k === "prim"
        ? desc.prim
        : this.primForDesc(desc, { type: "string" }),
    ];
    ctx.target.blocks[id].inputs.OPERAND2 = [1, [10, "true"]];
    return [2, id];
  }

  booleanLiteralBlock(ctx, value) {
    const id = this.addBlock(ctx, { opcode: "operator_equals" });
    ctx.target.blocks[id].inputs.OPERAND1 = [1, [10, value ? "true" : "false"]];
    ctx.target.blocks[id].inputs.OPERAND2 = [1, [10, "true"]];
    return id;
  }

  primForDesc(desc, spec) {
    if (desc.k === "var") return [12, desc.name, desc.id];
    if (desc.k === "list") return [13, desc.name, desc.id];
    return this.defaultPrim(spec);
  }

  valueInput(desc, spec, parentId) {
    if (desc.k === "var") {
      return [3, [12, desc.name, desc.id], this.defaultPrim(spec)];
    }
    if (desc.k === "list") {
      return [3, [13, desc.name, desc.id], this.defaultPrim(spec)];
    }
    if (desc.k === "prim") {
      if (spec.type === "color") return [1, [9, normalizeColor(desc.prim[1])]];
      if (spec.type === "any") return [1, desc.prim];
      return [1, this.coercePrim(desc, spec)];
    }
    // block
    if (this.ctx.target.blocks[desc.id])
      this.ctx.target.blocks[desc.id].parent = parentId;
    return [3, desc.id, this.defaultPrim(spec)];
  }

  coercePrim(desc, spec) {
    const raw = desc.prim[1];
    if (spec.type === "string") return [10, String(raw)];
    const num = Number(raw);
    const value = Number.isFinite(num) ? String(num) : "0";
    const typeNum = NUMBER_TYPES[spec.type] || 4;
    return [typeNum, value];
  }

  literalValue(expr) {
    if (!expr) return "";
    switch (expr.type) {
      case "String":
        return expr.value;
      case "Number":
        return expr.value;
      case "Boolean":
        return expr.value;
      case "Identifier":
        return expr.name;
      default:
        return "";
    }
  }

  // -------------------------------------------------------- expressions

  emitExpr(ctx, node) {
    if (!node) return { k: "prim", prim: [10, ""] };
    switch (node.type) {
      case "Number":
        return { k: "prim", prim: [4, String(node.value)] };
      case "String":
        return { k: "prim", prim: [10, node.value] };
      case "Boolean":
        return { k: "prim", prim: [10, node.value ? "true" : "false"] };
      case "Identifier":
        return this.emitIdentifier(ctx, node);
      case "Call": {
        const result = this.emitCall(ctx, node, null);
        return { k: "block", id: result.id, kind: result.kind };
      }
      case "Binary":
        return this.emitBinary(ctx, node);
      case "Unary":
        return this.emitUnary(ctx, node);
      default:
        this.fail(`Unsupported expression ${node.type}`, node.loc);
    }
    return null;
  }

  emitIdentifier(ctx, node) {
    if (node.segments.length > 1)
      this.fail(
        `Unexpected dotted name ${JSON.stringify(node.name)}`,
        node.loc,
      );
    const resolved = ctx.resolveValue(node.name);
    if (!resolved)
      this.fail(`Unknown variable ${JSON.stringify(node.name)}`, node.loc);
    if (resolved.kind === "param") {
      const id = this.addBlock(ctx, {
        opcode: resolved.param.boolean
          ? "argument_reporter_boolean"
          : "argument_reporter_string_number",
        fields: { VALUE: [resolved.param.name, null] },
      });
      return {
        k: "block",
        id,
        kind: resolved.param.boolean ? "boolean" : "reporter",
      };
    }
    if (resolved.kind === "var")
      return { k: "var", name: resolved.name, id: resolved.id };
    return { k: "list", name: resolved.name, id: resolved.id };
  }

  emitBinary(ctx, node) {
    switch (node.op) {
      case "and":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.and",
            null,
            node.left,
            node.right,
          ),
          kind: "boolean",
        };
      case "or":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.or",
            null,
            node.left,
            node.right,
          ),
          kind: "boolean",
        };
      case "==":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.equals",
            null,
            node.left,
            node.right,
          ),
          kind: "boolean",
        };
      case "<":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.lt",
            null,
            node.left,
            node.right,
          ),
          kind: "boolean",
        };
      case ">":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.gt",
            null,
            node.left,
            node.right,
          ),
          kind: "boolean",
        };
      case "!=":
        return this.emitNot(ctx, {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.equals",
            null,
            node.left,
            node.right,
          ),
        });
      case "<=":
        return this.emitNot(ctx, {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.gt",
            null,
            node.left,
            node.right,
          ),
        });
      case ">=":
        return this.emitNot(ctx, {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.lt",
            null,
            node.left,
            node.right,
          ),
        });
      case "+":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.add",
            null,
            node.left,
            node.right,
          ),
          kind: "reporter",
        };
      case "-":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.subtract",
            null,
            node.left,
            node.right,
          ),
          kind: "reporter",
        };
      case "*":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.multiply",
            null,
            node.left,
            node.right,
          ),
          kind: "reporter",
        };
      case "/":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.divide",
            null,
            node.left,
            node.right,
          ),
          kind: "reporter",
        };
      case "%":
        return {
          k: "block",
          id: this.emitBinaryBlock(
            ctx,
            "operators.mod",
            null,
            node.left,
            node.right,
          ),
          kind: "reporter",
        };
      default:
        this.fail(`Unsupported operator ${JSON.stringify(node.op)}`, node.loc);
    }
    return null;
  }

  /**
   * Emit a catalog binary/boolean block, returning its id.
   * @param {string} catalogName
   * @param {string|null} parentId
   * @param {object} left
   * @param {object} right
   */
  emitBinaryBlock(ctx, catalogName, parentId, left, right) {
    const entry = this.catalog[catalogName];
    if (!entry)
      this.fail(`Internal error: missing catalog entry ${catalogName}`);
    const inputNames = Object.keys(entry.inputs || {});
    const id = this.addBlock(ctx, { opcode: entry.opcode, parent: parentId });
    const exprs = [left, right];
    inputNames.forEach((name, i) => {
      const spec = entry.inputs[name];
      ctx.target.blocks[id].inputs[name] = this.buildInputForSpec(
        spec,
        exprs[i],
        id,
      );
    });
    return id;
  }

  emitNot(ctx, desc) {
    const id = this.addBlock(ctx, { opcode: "operator_not" });
    ctx.target.blocks[id].inputs.OPERAND = [2, desc.id];
    ctx.target.blocks[desc.id].parent = id;
    return { k: "block", id, kind: "boolean" };
  }

  emitUnary(ctx, node) {
    if (node.op === "not") {
      const operand = this.emitExpr(ctx, node.operand);
      if (operand.k === "block") {
        const id = this.addBlock(ctx, { opcode: "operator_not" });
        ctx.target.blocks[id].inputs.OPERAND = [2, operand.id];
        ctx.target.blocks[operand.id].parent = id;
        return { k: "block", id, kind: "boolean" };
      }
      const id = this.addBlock(ctx, { opcode: "operator_not" });
      ctx.target.blocks[id].inputs.OPERAND = this.booleanInput(
        ctx,
        node.operand,
        id,
      );
      return { k: "block", id, kind: "boolean" };
    }
    if (node.op === "-") {
      const id = this.addBlock(ctx, { opcode: "operator_subtract" });
      ctx.target.blocks[id].inputs.NUM1 = [1, [4, "0"]];
      ctx.target.blocks[id].inputs.NUM2 = this.buildInputForSpec(
        { type: "number" },
        node.operand,
        id,
      );
      return { k: "block", id, kind: "reporter" };
    }
    this.fail(
      `Unsupported unary operator ${JSON.stringify(node.op)}`,
      node.loc,
    );
    return null;
  }

  // ------------------------------------------------------------ assembly

  assembleProject(contexts) {
    const targets = [];
    const extensions = new Set();

    for (const ctx of contexts) {
      const target = ctx.target;
      if (target.isStage) {
        // broadcasts live on the stage
        for (const [name, id] of this.broadcasts) target.broadcasts[id] = name;
        this.ensureStageAssets(target);
        const comment = configComment(this.projectConfig);
        if (comment) {
          const commentId = uid("c");
          target.comments[commentId] = {
            blockId: null,
            x: 50,
            y: 50,
            width: 350,
            height: 170,
            minimized: false,
            text: comment,
          };
        }
      } else {
        this.ensureSpriteAssets(target);
      }

      for (const block of Object.values(target.blocks)) {
        const ext =
          this.opcodeExtensions.get(block.opcode) ||
          extensionForOpcode(block.opcode);
        if (ext) extensions.add(ext);
      }
      targets.push(this.serializeTarget(target));
    }

    // Sprites with an explicit layer keep it; others are ordered by declaration.
    targets.forEach((target, index) => {
      if (
        !target.isStage &&
        (target.layerOrder === 0 || target.layerOrder == null)
      ) {
        target.layerOrder = index;
      }
    });

    const project = {
      targets,
      monitors: [],
      extensions: Array.from(extensions).sort(),
      meta: { semver: "3.0.0", vm: "0.2.0", agent: "" },
    };

    const urls = {};
    for (const id of Object.keys(this.extensionUrls)) {
      if (extensions.has(id)) urls[id] = this.extensionUrls[id];
    }
    // Include configured extensions even if no block references them yet.
    for (const id of Object.keys(this.extensionUrls)) {
      if (!project.extensions.includes(id)) project.extensions.push(id);
      urls[id] = this.extensionUrls[id];
    }
    project.extensions.sort();
    if (Object.keys(urls).length) project.extensionURLs = urls;

    return project;
  }

  ensureStageAssets(target) {
    if (target.costumes.length === 0) {
      const width = this.projectConfig.width || 480;
      const height = this.projectConfig.height || 360;
      const buffer = Buffer.from(blankSvg(width, height, true));
      const asset = this.registerAsset(buffer, "svg");
      target.costumes.push({
        name: "backdrop1",
        bitmapResolution: 1,
        dataFormat: "svg",
        assetId: asset.assetId,
        md5ext: asset.md5ext,
        rotationCenterX: width / 2,
        rotationCenterY: height / 2,
      });
    }
  }

  ensureSpriteAssets(target) {
    if (target.costumes.length === 0) {
      const buffer = Buffer.from(blankSvg(100, 100, false));
      const asset = this.registerAsset(buffer, "svg");
      target.costumes.push({
        name: "costume1",
        bitmapResolution: 1,
        dataFormat: "svg",
        assetId: asset.assetId,
        md5ext: asset.md5ext,
        rotationCenterX: 50,
        rotationCenterY: 50,
      });
    }
  }

  serializeTarget(target) {
    const base = {
      isStage: target.isStage,
      name: target.isStage ? "Stage" : target.name,
      variables: target.variables,
      lists: target.lists,
      broadcasts: target.broadcasts,
      blocks: target.blocks,
      comments: target.comments,
      currentCostume: 0,
      costumes: target.costumes,
      sounds: target.sounds,
      volume: target.volume,
      layerOrder: target.layerOrder,
    };

    if (target.isStage) {
      return {
        ...base,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      };
    }
    return {
      ...base,
      visible: target.visible,
      x: target.x,
      y: target.y,
      size: target.size,
      direction: target.direction,
      draggable: target.draggable,
      rotationStyle: target.rotationStyle,
    };
  }
}

/**
 * Convenience helper: compile an AST (or source string) into project JSON.
 * @param {object} ast
 * @param {object} options
 */
export function compile(ast, options) {
  return new Compiler(options).compile(ast);
}
