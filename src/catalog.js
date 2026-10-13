/**
 * MeowScript block catalog.
 *
 * This module is the single source of truth for how a MeowScript
 * `category.function(...)` call maps onto a Scratch/PenguinMod opcode: its shape
 * (command/reporter/boolean/hat), its inputs, its dropdown fields and any
 * mutation it requires. The compiler, the decompiler and the editor tooling all
 * read from here instead of hard-coding opcode tables.
 *
 * Input descriptors:
 *   {type: 'number'|'positive'|'whole'|'integer'|'angle'|'string'|'color'
 *          |'boolean'|'substack'|'broadcast'|'variable'|'list'}
 *   {type: 'menu', menu: <shadow opcode>, field: <field name>, default: <value>}
 *
 * Field descriptors are plain objects providing the default dropdown value.
 */

// Common reusable menu descriptors -----------------------------------------
const GOTO_MENU = {
  type: "menu",
  menu: "motion_goto_menu",
  field: "TO",
  default: "_mouse_",
};
// `motion_glideto` has its own shadow menu block (`motion_glideto_menu`), even
// though it uses the same `TO` field name as `motion_goto_menu`.
const GLIDE_MENU = {
  type: "menu",
  menu: "motion_glideto_menu",
  field: "TO",
  default: "_mouse_",
};
const POINT_MENU = {
  type: "menu",
  menu: "motion_pointtowards_menu",
  field: "TOWARDS",
  default: "_mouse_",
};
const TOUCHING_MENU = {
  type: "menu",
  menu: "sensing_touchingobjectmenu",
  field: "TOUCHINGOBJECTMENU",
  default: "_mouse_",
};
const DISTANCE_MENU = {
  type: "menu",
  menu: "sensing_distancetomenu",
  field: "DISTANCETOMENU",
  default: "_mouse_",
};
const KEY_MENU = {
  type: "menu",
  menu: "sensing_keyoptions",
  field: "KEY_OPTION",
  default: "space",
};
const COSTUME_MENU = {
  type: "menu",
  menu: "looks_costume",
  field: "COSTUME",
  default: "costume1",
};
const BACKDROP_MENU = {
  type: "menu",
  menu: "looks_backdrops",
  field: "BACKDROP",
  default: "backdrop1",
};
const SOUND_MENU = {
  type: "menu",
  menu: "sound_sounds_menu",
  field: "SOUND_MENU",
  default: "pop",
};
const CLONE_MENU = {
  type: "menu",
  menu: "control_create_clone_of_menu",
  field: "CLONE_OPTION",
  default: "_myself_",
};
const OF_MENU = {
  type: "menu",
  menu: "sensing_of_object_menu",
  field: "OBJECT",
  default: "_stage_",
};

/** @type {Record<string, object>} */
export const CATALOG = {
  // ---------------------------------------------------------------- motion
  "motion.moveSteps": {
    opcode: "motion_movesteps",
    kind: "command",
    inputs: { STEPS: { type: "number" } },
  },
  "motion.turnRight": {
    opcode: "motion_turnright",
    kind: "command",
    inputs: { DEGREES: { type: "number" } },
  },
  "motion.turnLeft": {
    opcode: "motion_turnleft",
    kind: "command",
    inputs: { DEGREES: { type: "number" } },
  },
  "motion.goToXY": {
    opcode: "motion_gotoxy",
    kind: "command",
    inputs: { X: { type: "number" }, Y: { type: "number" } },
  },
  "motion.goTo": {
    opcode: "motion_goto",
    kind: "command",
    inputs: { TO: GOTO_MENU },
  },
  "motion.glideToXY": {
    opcode: "motion_glidesecstoxy",
    kind: "command",
    inputs: {
      SECS: { type: "number" },
      X: { type: "number" },
      Y: { type: "number" },
    },
  },
  "motion.glideTo": {
    opcode: "motion_glideto",
    kind: "command",
    inputs: { SECS: { type: "number" }, TO: GLIDE_MENU },
  },
  "motion.pointInDirection": {
    opcode: "motion_pointindirection",
    kind: "command",
    inputs: { DIRECTION: { type: "angle" } },
  },
  "motion.pointTowards": {
    opcode: "motion_pointtowards",
    kind: "command",
    inputs: { TOWARDS: POINT_MENU },
  },
  "motion.changeX": {
    opcode: "motion_changexby",
    kind: "command",
    inputs: { DX: { type: "number" } },
  },
  "motion.setX": {
    opcode: "motion_setx",
    kind: "command",
    inputs: { X: { type: "number" } },
  },
  "motion.changeY": {
    opcode: "motion_changeyby",
    kind: "command",
    inputs: { DY: { type: "number" } },
  },
  "motion.setY": {
    opcode: "motion_sety",
    kind: "command",
    inputs: { Y: { type: "number" } },
  },
  "motion.ifOnEdgeBounce": { opcode: "motion_ifonedgebounce", kind: "command" },
  "motion.setRotationStyle": {
    opcode: "motion_setrotationstyle",
    kind: "command",
    fields: { STYLE: "all around" },
  },
  "motion.xPosition": { opcode: "motion_xposition", kind: "reporter" },
  "motion.yPosition": { opcode: "motion_yposition", kind: "reporter" },
  "motion.direction": { opcode: "motion_direction", kind: "reporter" },

  // ----------------------------------------------------------------- looks
  "looks.say": {
    opcode: "looks_say",
    kind: "command",
    inputs: { MESSAGE: { type: "string" } },
  },
  "looks.sayForSecs": {
    opcode: "looks_sayforsecs",
    kind: "command",
    inputs: { MESSAGE: { type: "string" }, SECS: { type: "number" } },
  },
  "looks.think": {
    opcode: "looks_think",
    kind: "command",
    inputs: { MESSAGE: { type: "string" } },
  },
  "looks.thinkForSecs": {
    opcode: "looks_thinkforsecs",
    kind: "command",
    inputs: { MESSAGE: { type: "string" }, SECS: { type: "number" } },
  },
  "looks.switchCostume": {
    opcode: "looks_switchcostumeto",
    kind: "command",
    inputs: { COSTUME: COSTUME_MENU },
  },
  "looks.nextCostume": { opcode: "looks_nextcostume", kind: "command" },
  "looks.switchBackdrop": {
    opcode: "looks_switchbackdropto",
    kind: "command",
    inputs: { BACKDROP: BACKDROP_MENU },
  },
  "looks.switchBackdropAndWait": {
    opcode: "looks_switchbackdroptoandwait",
    kind: "command",
    inputs: { BACKDROP: BACKDROP_MENU },
  },
  "looks.nextBackdrop": { opcode: "looks_nextbackdrop", kind: "command" },
  "looks.changeSize": {
    opcode: "looks_changesizeby",
    kind: "command",
    inputs: { CHANGE: { type: "number" } },
  },
  "looks.setSize": {
    opcode: "looks_setsizeto",
    kind: "command",
    inputs: { SIZE: { type: "number" } },
  },
  "looks.changeEffect": {
    opcode: "looks_changeeffectby",
    kind: "command",
    fields: { EFFECT: "color" },
    inputs: { CHANGE: { type: "number" } },
  },
  "looks.setEffect": {
    opcode: "looks_seteffectto",
    kind: "command",
    fields: { EFFECT: "color" },
    inputs: { VALUE: { type: "number" } },
  },
  "looks.clearEffects": {
    opcode: "looks_cleargraphiceffects",
    kind: "command",
  },
  "looks.show": { opcode: "looks_show", kind: "command" },
  "looks.hide": { opcode: "looks_hide", kind: "command" },
  "looks.goToFrontLayer": {
    opcode: "looks_gotofrontback",
    kind: "command",
    fields: { FRONT_BACK: "front" },
  },
  "looks.goLayers": {
    opcode: "looks_goforwardbackwardlayers",
    kind: "command",
    fields: { FORWARD_BACKWARD: "forward" },
    inputs: { NUM: { type: "integer" } },
  },
  "looks.costumeNumber": {
    opcode: "looks_costumenumbername",
    kind: "reporter",
    fields: { NUMBER_NAME: "number" },
  },
  "looks.backdropNumber": {
    opcode: "looks_backdropnumbername",
    kind: "reporter",
    fields: { NUMBER_NAME: "number" },
  },
  "looks.size": { opcode: "looks_size", kind: "reporter" },

  // ----------------------------------------------------------------- sound
  "sound.play": {
    opcode: "sound_play",
    kind: "command",
    inputs: { SOUND_MENU: SOUND_MENU },
  },
  "sound.playUntilDone": {
    opcode: "sound_playuntildone",
    kind: "command",
    inputs: { SOUND_MENU: SOUND_MENU },
  },
  "sound.stopAllSounds": { opcode: "sound_stopallsounds", kind: "command" },
  "sound.changeEffect": {
    opcode: "sound_changeeffectby",
    kind: "command",
    fields: { EFFECT: "pitch" },
    inputs: { VALUE: { type: "number" } },
  },
  "sound.setEffect": {
    opcode: "sound_seteffectto",
    kind: "command",
    fields: { EFFECT: "pitch" },
    inputs: { VALUE: { type: "number" } },
  },
  "sound.clearEffects": { opcode: "sound_cleareffects", kind: "command" },
  "sound.changeVolume": {
    opcode: "sound_changevolumeby",
    kind: "command",
    inputs: { VOLUME: { type: "number" } },
  },
  "sound.setVolume": {
    opcode: "sound_setvolumeto",
    kind: "command",
    inputs: { VOLUME: { type: "number" } },
  },
  "sound.volume": { opcode: "sound_volume", kind: "reporter" },

  // --------------------------------------------------------------- sensing
  "sensing.touching": {
    opcode: "sensing_touchingobject",
    kind: "boolean",
    inputs: { TOUCHINGOBJECTMENU: TOUCHING_MENU },
  },
  "sensing.touchingColor": {
    opcode: "sensing_touchingcolor",
    kind: "boolean",
    inputs: { COLOR: { type: "color" } },
  },
  "sensing.colorIsTouchingColor": {
    opcode: "sensing_coloristouchingcolor",
    kind: "boolean",
    inputs: { COLOR: { type: "color" }, COLOR2: { type: "color" } },
  },
  "sensing.distanceTo": {
    opcode: "sensing_distanceto",
    kind: "reporter",
    inputs: { DISTANCETOMENU: DISTANCE_MENU },
  },
  "sensing.askAndWait": {
    opcode: "sensing_askandwait",
    kind: "command",
    inputs: { QUESTION: { type: "string" } },
  },
  "sensing.answer": { opcode: "sensing_answer", kind: "reporter" },
  "sensing.keyPressed": {
    opcode: "sensing_keypressed",
    kind: "boolean",
    inputs: { KEY_OPTION: KEY_MENU },
  },
  "sensing.mouseDown": { opcode: "sensing_mousedown", kind: "boolean" },
  "sensing.mouseX": { opcode: "sensing_mousex", kind: "reporter" },
  "sensing.mouseY": { opcode: "sensing_mousey", kind: "reporter" },
  "sensing.loudness": { opcode: "sensing_loudness", kind: "reporter" },
  "sensing.timer": { opcode: "sensing_timer", kind: "reporter" },
  "sensing.resetTimer": { opcode: "sensing_resettimer", kind: "command" },
  "sensing.propertyOf": {
    opcode: "sensing_of",
    kind: "reporter",
    fields: { PROPERTY: "x position" },
    inputs: { OBJECT: OF_MENU },
  },
  "sensing.current": {
    opcode: "sensing_current",
    kind: "reporter",
    fields: { CURRENTMENU: "year" },
  },
  "sensing.daysSince2000": {
    opcode: "sensing_dayssince2000",
    kind: "reporter",
  },
  "sensing.username": { opcode: "sensing_username", kind: "reporter" },

  // ------------------------------------------------------------- operators
  "operators.add": {
    opcode: "operator_add",
    kind: "reporter",
    inputs: { NUM1: { type: "number" }, NUM2: { type: "number" } },
  },
  "operators.subtract": {
    opcode: "operator_subtract",
    kind: "reporter",
    inputs: { NUM1: { type: "number" }, NUM2: { type: "number" } },
  },
  "operators.multiply": {
    opcode: "operator_multiply",
    kind: "reporter",
    inputs: { NUM1: { type: "number" }, NUM2: { type: "number" } },
  },
  "operators.divide": {
    opcode: "operator_divide",
    kind: "reporter",
    inputs: { NUM1: { type: "number" }, NUM2: { type: "number" } },
  },
  "operators.random": {
    opcode: "operator_random",
    kind: "reporter",
    inputs: { FROM: { type: "number" }, TO: { type: "number" } },
  },
  "operators.gt": {
    opcode: "operator_gt",
    kind: "boolean",
    inputs: { OPERAND1: { type: "string" }, OPERAND2: { type: "string" } },
  },
  "operators.lt": {
    opcode: "operator_lt",
    kind: "boolean",
    inputs: { OPERAND1: { type: "string" }, OPERAND2: { type: "string" } },
  },
  "operators.equals": {
    opcode: "operator_equals",
    kind: "boolean",
    inputs: { OPERAND1: { type: "string" }, OPERAND2: { type: "string" } },
  },
  "operators.and": {
    opcode: "operator_and",
    kind: "boolean",
    inputs: { OPERAND1: { type: "boolean" }, OPERAND2: { type: "boolean" } },
  },
  "operators.or": {
    opcode: "operator_or",
    kind: "boolean",
    inputs: { OPERAND1: { type: "boolean" }, OPERAND2: { type: "boolean" } },
  },
  "operators.not": {
    opcode: "operator_not",
    kind: "boolean",
    inputs: { OPERAND: { type: "boolean" } },
  },
  "operators.join": {
    opcode: "operator_join",
    kind: "reporter",
    inputs: { STRING1: { type: "string" }, STRING2: { type: "string" } },
  },
  "operators.letterOf": {
    opcode: "operator_letter_of",
    kind: "reporter",
    inputs: { LETTER: { type: "number" }, STRING: { type: "string" } },
  },
  "operators.length": {
    opcode: "operator_length",
    kind: "reporter",
    inputs: { STRING: { type: "string" } },
  },
  "operators.contains": {
    opcode: "operator_contains",
    kind: "boolean",
    inputs: { STRING1: { type: "string" }, STRING2: { type: "string" } },
  },
  "operators.mod": {
    opcode: "operator_mod",
    kind: "reporter",
    inputs: { NUM1: { type: "number" }, NUM2: { type: "number" } },
  },
  "operators.round": {
    opcode: "operator_round",
    kind: "reporter",
    inputs: { NUM: { type: "number" } },
  },
  "operators.math": {
    opcode: "operator_mathop",
    kind: "reporter",
    fields: { OPERATOR: "abs" },
    inputs: { NUM: { type: "number" } },
  },

  // --------------------------------------------------------------- control
  "control.wait": {
    opcode: "control_wait",
    kind: "command",
    inputs: { DURATION: { type: "positive" } },
  },
  "control.repeat": {
    opcode: "control_repeat",
    kind: "command",
    inputs: { TIMES: { type: "whole" }, SUBSTACK: { type: "substack" } },
  },
  "control.forever": {
    opcode: "control_forever",
    kind: "command",
    inputs: { SUBSTACK: { type: "substack" } },
    // PenguinMod builds this loop without a next-statement connection and only
    // creates one from the block's mutation (`hasbreak` — the nub the editor
    // adds by itself once a block sits below the loop). Blocks stacked under a
    // `control.forever` therefore need that mutation: without it the editor's
    // XML loader dereferences the missing connection while reading the
    // following `<next>` element and the whole workspace update fails.
    dynamicNext: true,
  },
  "control.if": {
    opcode: "control_if",
    kind: "command",
    inputs: { CONDITION: { type: "boolean" }, SUBSTACK: { type: "substack" } },
  },
  "control.ifElse": {
    opcode: "control_if_else",
    kind: "command",
    inputs: {
      CONDITION: { type: "boolean" },
      SUBSTACK: { type: "substack" },
      SUBSTACK2: { type: "substack" },
    },
  },
  "control.waitUntil": {
    opcode: "control_wait_until",
    kind: "command",
    inputs: { CONDITION: { type: "boolean" } },
  },
  "control.repeatUntil": {
    opcode: "control_repeat_until",
    kind: "command",
    inputs: { CONDITION: { type: "boolean" }, SUBSTACK: { type: "substack" } },
  },
  "control.stop": {
    opcode: "control_stop",
    kind: "command",
    fields: { STOP_OPTION: "all" },
    stopBlock: true,
  },
  "control.clone": {
    opcode: "control_create_clone_of",
    kind: "command",
    inputs: { CLONE_OPTION: CLONE_MENU },
  },
  "control.deleteThisClone": {
    opcode: "control_delete_this_clone",
    kind: "command",
  },

  // ---------------------------------------------------------------- events
  "events.broadcast": {
    opcode: "event_broadcast",
    kind: "command",
    inputs: { BROADCAST_INPUT: { type: "broadcast" } },
  },
  "events.broadcastAndWait": {
    opcode: "event_broadcastandwait",
    kind: "command",
    inputs: { BROADCAST_INPUT: { type: "broadcast" } },
  },

  // --------------------------------------------------------------- hats
  "events.greenFlag": {
    opcode: "event_whenflagclicked",
    kind: "hat",
    args: [],
  },
  "events.keyPressed": {
    opcode: "event_whenkeypressed",
    kind: "hat",
    args: [{ field: "KEY_OPTION", default: "space" }],
  },
  "events.spriteClicked": {
    opcode: "event_whenthisspriteclicked",
    kind: "hat",
    args: [],
  },
  "events.stageClicked": {
    opcode: "event_whenstageclicked",
    kind: "hat",
    args: [],
  },
  "events.cloneStart": {
    opcode: "control_start_as_clone",
    kind: "hat",
    args: [],
  },
  "events.broadcastReceived": {
    opcode: "event_whenbroadcastreceived",
    kind: "hat",
    args: [{ field: "BROADCAST_OPTION", type: "broadcast" }],
  },
  "events.backdropSwitchesTo": {
    opcode: "event_whenbackdropswitchesto",
    kind: "hat",
    args: [{ field: "BACKDROP", default: "backdrop1" }],
  },
  // The dropdown field is `WHENGREATERTHANMENU` in TurboWarp/PenguinMod (the
  // vanilla Scratch 3 name is `WHENGREATER`); the option values are the
  // uppercase menu ids `LOUDNESS`/`TIMER`. See PenguinMod-Blocks event.js and
  // scratch3_event.js.
  "events.loudnessGreaterThan": {
    opcode: "event_whengreaterthan",
    kind: "hat",
    args: [
      { input: "VALUE", type: "number" },
      { field: "WHENGREATERTHANMENU", value: "LOUDNESS" },
    ],
  },
  "events.timerGreaterThan": {
    opcode: "event_whengreaterthan",
    kind: "hat",
    args: [
      { input: "VALUE", type: "number" },
      { field: "WHENGREATERTHANMENU", value: "TIMER" },
    ],
  },

  // ------------------------------------------------------------------ pen
  "pen.clear": { opcode: "pen_clear", kind: "command", extension: "pen" },
  "pen.stamp": { opcode: "pen_stamp", kind: "command", extension: "pen" },
  "pen.penDown": { opcode: "pen_penDown", kind: "command", extension: "pen" },
  "pen.penUp": { opcode: "pen_penUp", kind: "command", extension: "pen" },
  "pen.setColor": {
    opcode: "pen_setPenColorToColor",
    kind: "command",
    inputs: { COLOR: { type: "color" } },
    extension: "pen",
  },
  "pen.changeSize": {
    opcode: "pen_changePenSizeBy",
    kind: "command",
    inputs: { SIZE: { type: "number" } },
    extension: "pen",
  },
  "pen.setSize": {
    opcode: "pen_setPenSizeTo",
    kind: "command",
    inputs: { SIZE: { type: "number" } },
    extension: "pen",
  },
  // COLOR_PARAM is an input whose shadow is `pen_menu_colorParam`, not a
  // direct field: the pen extension declares `colorParam` with
  // `acceptReporters: true`, so the workspace serializes it as a value input
  // wrapping a shadow menu block (field name `colorParam`).
  "pen.changeColorParam": {
    opcode: "pen_changePenColorParamBy",
    kind: "command",
    inputs: {
      COLOR_PARAM: {
        type: "menu",
        menu: "pen_menu_colorParam",
        field: "colorParam",
        default: "color",
      },
      VALUE: { type: "number" },
    },
    extension: "pen",
  },
  "pen.setColorParam": {
    opcode: "pen_setPenColorParamTo",
    kind: "command",
    inputs: {
      COLOR_PARAM: {
        type: "menu",
        menu: "pen_menu_colorParam",
        field: "colorParam",
        default: "color",
      },
      VALUE: { type: "number" },
    },
    extension: "pen",
  },

  // ------------------------------------------------------------ penguinmod
  "pm.lastKeyPressed": {
    opcode: "argument_reporter_string_number",
    kind: "reporter",
    fields: { VALUE: ["last key pressed", null] },
  },
  "pm.isCompiled": {
    opcode: "argument_reporter_boolean",
    kind: "boolean",
    fields: { VALUE: ["is compiled?", null] },
  },
  "pm.isPenguinMod": {
    opcode: "argument_reporter_boolean",
    kind: "boolean",
    fields: { VALUE: ["is penguinmod?", null] },
  },
};

/**
 * Native Scratch variable/list mutation opcodes used when a list method is
 * called (`items.push(x)` etc.).
 */
export const LIST_OPS = {
  push: {
    opcode: "data_addtolist",
    kind: "command",
    inputs: ["ITEM"],
    aliases: ["add", "append"],
  },
  insert: {
    opcode: "data_insertatlist",
    kind: "command",
    inputs: ["INDEX", "ITEM"],
  },
  replace: {
    opcode: "data_replaceitemoflist",
    kind: "command",
    inputs: ["INDEX", "ITEM"],
    aliases: ["set"],
  },
  deleteAt: {
    opcode: "data_deleteoflist",
    kind: "command",
    inputs: ["INDEX"],
    aliases: ["remove", "delete"],
  },
  deleteAll: {
    opcode: "data_deletealloflist",
    kind: "command",
    inputs: [],
    aliases: ["clear"],
  },
  show: { opcode: "data_showlist", kind: "command", inputs: [] },
  hide: { opcode: "data_hidelist", kind: "command", inputs: [] },
  itemAt: {
    opcode: "data_itemoflist",
    kind: "reporter",
    inputs: ["INDEX"],
    aliases: ["at"],
  },
  itemNumber: {
    opcode: "data_itemnumoflist",
    kind: "reporter",
    inputs: ["ITEM"],
    aliases: ["indexOf"],
  },
  length: { opcode: "data_lengthoflist", kind: "reporter", inputs: [] },
  contains: {
    opcode: "data_listcontainsitem",
    kind: "boolean",
    inputs: ["ITEM"],
  },
};

/** Reverse lookup built once: opcode -> canonical catalog name. */
export const BY_OPCODE = (() => {
  const map = new Map();
  for (const [name, entry] of Object.entries(CATALOG)) {
    if (!map.has(entry.opcode)) map.set(entry.opcode, name);
  }
  return map;
})();

/** Core (non-extension) opcode prefixes. */
export const CORE_EXTENSIONS = new Set([
  "argument",
  "colour",
  "control",
  "data",
  "event",
  "looks",
  "math",
  "motion",
  "operator",
  "procedures",
  "sensing",
  "sound",
]);

/**
 * Determine the extension id (if any) required by an opcode.
 * @param {string} opcode
 * @returns {string|null}
 */
export function extensionForOpcode(opcode) {
  const index = opcode.indexOf("_");
  if (index < 0) return null;
  const prefix = opcode.slice(0, index);
  if (CORE_EXTENSIONS.has(prefix)) return null;
  return prefix;
}

/** Resolve a catalog entry, following aliases like `motion.moveSteps`. */
export function lookup(name) {
  if (Object.prototype.hasOwnProperty.call(CATALOG, name)) return CATALOG[name];
  return null;
}

/** List every canonical block name in the catalog. */
export function blockNames() {
  return Object.keys(CATALOG).sort();
}
