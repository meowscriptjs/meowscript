/**
 * MeowScript decompiler: Scratch 3 / TurboWarp project JSON -> `.ms` source.
 *
 * This is the inverse of `compiler.js`. It leans on the same catalog (reverse
 * opcode lookup) so the two stay in sync.
 */
import { CATALOG, BY_OPCODE } from "./catalog.js";
import { unzipSync } from "./sb3.js";

const MENU_OPCODES = new Set([
  "motion_goto_menu",
  "motion_pointtowards_menu",
  "sensing_touchingobjectmenu",
  "sensing_distancetomenu",
  "sensing_keyoptions",
  "looks_costume",
  "looks_backdrops",
  "sound_sounds_menu",
  "control_create_clone_of_menu",
  "sensing_of_object_menu",
]);

const BINARY_OPCODES = {
  operator_add: "+",
  operator_subtract: "-",
  operator_multiply: "*",
  operator_divide: "/",
  operator_mod: "%",
  operator_gt: ">",
  operator_lt: "<",
  operator_equals: "==",
  operator_and: "and",
  operator_or: "or",
};

const LIST_OPCODE_METHOD = {
  data_addtolist: { method: "push", inputs: ["ITEM"] },
  data_insertatlist: { method: "insert", inputs: ["INDEX", "ITEM"] },
  data_replaceitemoflist: { method: "replace", inputs: ["INDEX", "ITEM"] },
  data_deleteoflist: { method: "deleteAt", inputs: ["INDEX"] },
  data_deletealloflist: { method: "deleteAll", inputs: [] },
  data_showlist: { method: "show", inputs: [] },
  data_hidelist: { method: "hide", inputs: [] },
  data_itemoflist: { method: "itemAt", inputs: ["INDEX"] },
  data_itemnumoflist: { method: "itemNumber", inputs: ["ITEM"] },
  data_lengthoflist: { method: "length", inputs: [] },
  data_listcontainsitem: { method: "contains", inputs: ["ITEM"] },
};

function escapeString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function numberText(value) {
  const n = Number(value);
  if (Number.isFinite(n) && String(n) === String(value)) return String(value);
  return String(value);
}

class Decompiler {
  constructor(project, options = {}) {
    this.project = project;
    this.assetPrefix = options.assetPrefix || "";
    this.returningProccodes = new Set();
    for (const target of project.targets) {
      for (const block of Object.values(target.blocks)) {
        if (
          block.opcode === "procedures_call" &&
          block.mutation &&
          block.mutation.return
        ) {
          this.returningProccodes.add(block.mutation.proccode);
        }
        if (block.opcode === "procedures_definition") {
          const proto = target.blocks[firstOf(block.inputs.custom_block)];
          const proccode = proto && proto.mutation && proto.mutation.proccode;
          if (proccode && stackHasReturn(target, block.next))
            this.returningProccodes.add(proccode);
        }
      }
    }
  }

  targetVars(target) {
    const map = new Map();
    for (const [id, desc] of Object.entries(target.variables || {}))
      map.set(id, desc[0]);
    for (const [id, desc] of Object.entries(target.lists || {}))
      map.set(id, desc[0]);
    return map;
  }

  renderExpression(value) {
    if (value == null) return '""';
    if (!Array.isArray(value)) return this.renderBlock(value);
    const type = value[0];
    switch (type) {
      case 1:
      case 3:
        return this.renderInputRef(value[1]);
      case 2:
        return this.renderInputRef(value[1]);
      case 4:
      case 5:
      case 6:
      case 7:
        return numberText(value[1]);
      case 8:
        return numberText(value[1]);
      case 9:
        return `"${escapeString(value[1])}"`;
      case 10:
        return `"${escapeString(value[1])}"`;
      case 11:
        return `"${escapeString(value[1])}"`;
      case 12:
        return String(value[1]);
      case 13:
        return String(value[1]);
      default:
        return "0";
    }
  }

  renderInputRef(ref) {
    if (Array.isArray(ref)) return this.renderExpression(ref);
    if (ref == null) return "0";
    return this.renderBlock(ref);
  }

  renderBlock(id) {
    const block = this.target.blocks[id];
    if (!block) return "0";

    if (MENU_OPCODES.has(block.opcode)) {
      const field = Object.values(block.fields || {})[0];
      return field ? `"${escapeString(field[0])}"` : '""';
    }
    if (block.opcode === "data_variable") return block.fields.VARIABLE[0];
    if (block.opcode === "data_listcontents") return block.fields.LIST[0];
    if (
      block.opcode === "argument_reporter_string_number" ||
      block.opcode === "argument_reporter_boolean"
    ) {
      return block.fields.VALUE[0];
    }
    if (block.opcode === "procedures_call") {
      return this.renderProcedureCall(block);
    }
    if (Object.prototype.hasOwnProperty.call(BINARY_OPCODES, block.opcode)) {
      const left = this.renderExpression(
        block.inputs.OPERAND1 || block.inputs.NUM1,
      );
      const right = this.renderExpression(
        block.inputs.OPERAND2 || block.inputs.NUM2,
      );
      return `(${left} ${BINARY_OPCODES[block.opcode]} ${right})`;
    }
    if (block.opcode === "operator_not") {
      return `(not ${this.renderExpression(block.inputs.OPERAND)})`;
    }

    const name = BY_OPCODE.get(block.opcode);
    if (name) return this.renderCatalogCall(name, block);
    return `/* unknown ${block.opcode} */`;
  }

  renderCatalogCall(name, block) {
    const entry = CATALOG[name];
    const args = [];
    for (const key of Object.keys(entry.fields || {})) {
      const field = block.fields[key];
      if (field) args.push(`"${escapeString(field[0])}"`);
    }
    for (const [inputName, spec] of Object.entries(entry.inputs || {})) {
      if (spec.type === "substack") continue;
      args.push(this.renderExpression(block.inputs[inputName]));
    }
    return `${name}(${args.join(", ")})`;
  }

  renderProcedureCall(block) {
    const mutation = block.mutation || {};
    const proccode = mutation.proccode || "";
    const name = proccode.split(" ")[0];
    const ids = mutation.argumentids ? JSON.parse(mutation.argumentids) : [];
    const args = ids.map((argId) => this.renderExpression(block.inputs[argId]));
    return `${name}(${args.join(", ")})`;
  }

  // ---------------------------------------------------------- statements

  renderStack(firstId, indent) {
    const lines = [];
    let id = firstId;
    while (id) {
      const block = this.target.blocks[id];
      if (!block) break;
      lines.push(this.renderStatement(block, indent));
      id = block.next;
    }
    return lines.filter(Boolean).join("\n");
  }

  renderStatement(block, indent) {
    const pad = "    ".repeat(indent);
    const sub = (firstId) => {
      if (!firstId) return "";
      const body = this.renderStack(firstId, indent + 1);
      return body ? `\n${body}` : "";
    };

    switch (block.opcode) {
      case "data_setvariableto":
        return `${pad}${block.fields.VARIABLE[0]} = ${this.renderExpression(block.inputs.VALUE)};`;
      case "data_changevariableby":
        return `${pad}${block.fields.VARIABLE[0]} += ${this.renderExpression(block.inputs.VALUE)};`;
      case "control_if": {
        const cond = this.renderExpression(block.inputs.CONDITION);
        return `${pad}if (${stripParen(cond)}) {${sub(firstOf(block.inputs.SUBSTACK))}\n${pad}}`;
      }
      case "control_if_else": {
        const cond = this.renderExpression(block.inputs.CONDITION);
        return `${pad}if (${stripParen(cond)}) {${sub(firstOf(block.inputs.SUBSTACK))}\n${pad}} else {${sub(firstOf(block.inputs.SUBSTACK2))}\n${pad}}`;
      }
      case "control_forever":
        return `${pad}control.forever {${sub(firstOf(block.inputs.SUBSTACK))}\n${pad}}`;
      case "control_repeat":
        return `${pad}repeat (${this.renderExpression(block.inputs.TIMES)}) {${sub(firstOf(block.inputs.SUBSTACK))}\n${pad}}`;
      case "control_repeat_until":
        return `${pad}control.repeatUntil(${stripParen(this.renderExpression(block.inputs.CONDITION))}) {${sub(firstOf(block.inputs.SUBSTACK))}\n${pad}}`;
      case "control_wait_until":
        return `${pad}control.waitUntil(${stripParen(this.renderExpression(block.inputs.CONDITION))});`;
      case "procedures_return":
        return `${pad}return ${this.renderExpression(block.inputs.VALUE)};`;
      case "procedures_call":
        return `${pad}${this.renderProcedureCall(block)};`;
      case "control_stop":
        return `${pad}control.stop("${block.fields.STOP_OPTION[0]}");`;
      default: {
        if (
          Object.prototype.hasOwnProperty.call(LIST_OPCODE_METHOD, block.opcode)
        ) {
          const { method, inputs } = LIST_OPCODE_METHOD[block.opcode];
          const listName = block.fields.LIST[0];
          const args = inputs.map((input) =>
            this.renderExpression(block.inputs[input]),
          );
          return `${pad}${listName}.${method}(${args.join(", ")});`;
        }
        const name = BY_OPCODE.get(block.opcode);
        if (name && CATALOG[name].kind === "command") {
          return `${pad}${this.renderCatalogCall(name, block)};`;
        }
        if (name) return `${pad}${this.renderCatalogCall(name, block)};`;
        return `${pad}// unsupported block ${block.opcode}`;
      }
    }
  }

  renderHat(block, indent) {
    const pad = "";
    void indent;
    const body = (firstId) => this.renderStack(firstId, 1);
    switch (block.opcode) {
      case "event_whenflagclicked":
        return `${pad}when greenFlag {\n${body(block.next)}\n}`;
      case "event_whenkeypressed": {
        const key = block.fields.KEY_OPTION
          ? block.fields.KEY_OPTION[0]
          : "space";
        return `${pad}when keyPressed("${escapeString(key)}") {\n${body(block.next)}\n}`;
      }
      case "event_whenthisspriteclicked":
        return `${pad}when spriteClicked {\n${body(block.next)}\n}`;
      case "event_whenstageclicked":
        return `${pad}when stageClicked {\n${body(block.next)}\n}`;
      case "control_start_as_clone":
        return `${pad}when cloneStart {\n${body(block.next)}\n}`;
      case "event_whenbroadcastreceived":
        return `${pad}when broadcast("${escapeString(block.fields.BROADCAST_OPTION[0])}") {\n${body(block.next)}\n}`;
      case "event_whenbackdropswitchesto":
        return `${pad}when backdropSwitchesTo("${escapeString(block.fields.BACKDROP[0])}") {\n${body(block.next)}\n}`;
      case "event_whengreaterthan": {
        const kind =
          block.fields.WHENGREATER[0] === "timer"
            ? "timerGreaterThan"
            : "loudnessGreaterThan";
        return `${pad}when ${kind}(${this.renderExpression(block.inputs.VALUE)}) {\n${body(block.next)}\n}`;
      }
      default:
        return null;
    }
  }

  renderFunction(defBlock) {
    const protoId = firstOf(defBlock.inputs.custom_block);
    const proto = this.target.blocks[protoId];
    const mutation = (proto && proto.mutation) || {};
    const proccode = mutation.proccode || "procedure";
    const names = mutation.argumentnames
      ? JSON.parse(mutation.argumentnames)
      : [];
    const baseName = proccode.split(" ")[0];
    const returning = this.returningProccodes.has(proccode) ? "returning " : "";
    const params = names.join(", ");
    return `${returning}function ${baseName}(${params}) {\n${this.renderStack(defBlock.next, 1)}\n}`;
  }

  decompileTarget(target, indent = 0) {
    const previous = this.target;
    this.target = target;
    const pad = "    ".repeat(indent);
    const sections = [];

    // costumes / sounds
    const costumeEntries = (target.costumes || [])
      .map(
        (c) => `        ${safeKey(c.name)}: "${this.assetPrefix}${c.md5ext}"`,
      )
      .join(",\n");
    const soundEntries = (target.sounds || [])
      .map(
        (s) => `        ${safeKey(s.name)}: "${this.assetPrefix}${s.md5ext}"`,
      )
      .join(",\n");
    if (costumeEntries)
      sections.push(`${pad}costumes: {\n${costumeEntries}\n${pad}};`);
    if (soundEntries)
      sections.push(`${pad}sounds: {\n${soundEntries}\n${pad}};`);
    if (target.layerOrder != null && !target.isStage)
      sections.push(`${pad}layer: ${target.layerOrder};`);

    // variables + lists
    for (const [, desc] of Object.entries(target.variables || {})) {
      const cloud = desc[2] ? "cloud " : "";
      sections.push(`${pad}${cloud}let ${desc[0]} = ${literalText(desc[1])};`);
    }
    for (const [, desc] of Object.entries(target.lists || {})) {
      const items = (desc[1] || []).map((v) => literalText(v)).join(", ");
      sections.push(`${pad}list ${desc[0]} = [${items}];`);
    }

    // blocks
    const blockIds = Object.keys(target.blocks || {});
    const hats = blockIds.filter((id) => {
      const b = target.blocks[id];
      return b.topLevel && b.opcode !== "procedures_definition";
    });
    const defs = blockIds.filter(
      (id) => target.blocks[id].opcode === "procedures_definition",
    );

    for (const id of defs) {
      sections.push(indentText(this.renderFunction(target.blocks[id]), pad));
    }
    for (const id of hats) {
      const rendered = this.renderHat(target.blocks[id], indent);
      if (rendered) sections.push(indentText(rendered, pad));
      else
        sections.push(`${pad}// unsupported block ${target.blocks[id].opcode}`);
    }

    this.target = previous;
    return sections.join("\n\n");
  }

  decompile() {
    const out = [];
    const stage = this.project.targets.find((t) => t.isStage);
    const sprites = this.project.targets.filter((t) => !t.isStage);

    if (stage) {
      const body = this.decompileTarget(stage);
      if (body.trim()) out.push(body);
    }
    for (const sprite of sprites) {
      out.push(
        `sprite "${escapeString(sprite.name)}" {\n${this.decompileTarget(sprite, 1)}\n}`,
      );
    }
    return `${out.join("\n\n")}\n`;
  }
}

function firstOf(input) {
  if (!input) return null;
  if (Array.isArray(input))
    return typeof input[1] === "string" ? input[1] : null;
  return null;
}

/** Walk a statement stack (including substacks) looking for `return`. */
function stackHasReturn(target, firstId) {
  let id = firstId;
  while (id) {
    const block = target.blocks[id];
    if (!block) break;
    if (block.opcode === "procedures_return") return true;
    for (const [name, input] of Object.entries(block.inputs || {})) {
      if (!name.startsWith("SUBSTACK")) continue;
      const child = firstOf(input);
      if (child && stackHasReturn(target, child)) return true;
    }
    id = block.next;
  }
  return false;
}

function stripParen(text) {
  return text;
}

function literalText(value) {
  if (typeof value === "number") return String(value);
  if (value === true || value === false) return String(value);
  return `"${escapeString(value)}"`;
}

function safeKey(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? name
    : `"${escapeString(name)}"`;
}

function indentText(text, prefix) {
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * Decompile project JSON into MeowScript source.
 * @param {object} project
 * @param {{assetPrefix?: string}} [options]
 * @returns {string}
 */
export function decompileProject(project, options) {
  return new Decompiler(project, options).decompile();
}

/**
 * Decompile a `.sb3` buffer (or project JSON) into MeowScript source.
 * @param {Buffer|Uint8Array|object} input
 * @param {{assetPrefix?: string}} [options]
 * @returns {string}
 */
export function decompile(input, options) {
  if (
    input &&
    typeof input === "object" &&
    !Buffer.isBuffer(input) &&
    !(input instanceof Uint8Array) &&
    input.targets
  ) {
    return decompileProject(input, options);
  }
  const files = unzipSync(input);
  const json = files.get("project.json");
  if (!json) throw new Error("Not a Scratch project: missing project.json");
  return decompileProject(JSON.parse(json.toString("utf8")), options);
}
