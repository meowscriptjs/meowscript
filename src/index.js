/**
 * MeowScript public API.
 *
 * @example
 * import {build} from 'meowscript';
 * const {sb3} = build({file: 'src/player.ms'});
 * fs.writeFileSync('player.pmp', sb3);
 */
export { tokenize } from "./lexer.js";
export { parse } from "./parser.js";
export { Compiler, compile } from "./compiler.js";
export { build, writeSb3 } from "./build.js";
export { discoverSources, mergePrograms } from "./project.js";
export { decompile, decompileProject } from "./decompiler.js";
export { zipSync, unzipSync, md5hex, imageSize, wavInfo } from "./sb3.js";
export { loadExtensions } from "./extensions.js";
export * from "./catalog.js";
export * from "./config.js";
export { MeowError, LexError, ParseError, CompileError } from "./errors.js";
