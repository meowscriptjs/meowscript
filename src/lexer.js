/**
 * MeowScript lexer.
 *
 * Produces a flat list of tokens with 1-based line/column information so that
 * downstream errors can point at the exact source location.
 */
import { LexError } from "./errors.js";

const PUNCTUATION = [
  // longest first so that greedy matching works
  "+=",
  "-=",
  "*=",
  "/=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ",",
  ";",
  ":",
  ".",
  "=",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "!",
];

const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
const isIdentPart = (ch) => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch) => ch >= "0" && ch <= "9";

/**
 * @typedef {object} Token
 * @property {'ident'|'number'|'string'|'punct'|'eof'} type
 * @property {string} value
 * @property {number} line
 * @property {number} column
 */

/**
 * Tokenize a MeowScript source string.
 * @param {string} source
 * @param {string} [file]
 * @returns {Token[]}
 */
export function tokenize(source, file = "<input>") {
  const tokens = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const push = (type, value, startLine, startColumn) => {
    tokens.push({ type, value, line: startLine, column: startColumn, file });
  };

  const fail = (message, startLine = line, startColumn = column) => {
    throw new LexError(message, {
      file,
      line: startLine,
      column: startColumn,
      source,
    });
  };

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (source[i] === "\n") {
        line++;
        column = 1;
      } else {
        column++;
      }
      i++;
    }
  };

  while (i < source.length) {
    const ch = source[i];

    // --- whitespace -----------------------------------------------------
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // --- comments -------------------------------------------------------
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") advance();
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const startLine = line;
      const startColumn = column;
      advance(2);
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/"))
        advance();
      if (i >= source.length)
        fail("Unterminated block comment", startLine, startColumn);
      advance(2);
      continue;
    }

    const startLine = line;
    const startColumn = column;

    // --- strings --------------------------------------------------------
    if (ch === '"' || ch === "'") {
      const quote = ch;
      advance();
      let out = "";
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          const next = source[i + 1];
          const escapes = {
            n: "\n",
            t: "\t",
            r: "\r",
            '"': '"',
            "'": "'",
            "\\": "\\",
          };
          if (next in escapes) {
            out += escapes[next];
            advance(2);
          } else {
            out += next ?? "";
            advance(2);
          }
        } else {
          out += source[i];
          advance();
        }
      }
      if (i >= source.length)
        fail("Unterminated string literal", startLine, startColumn);
      advance(); // closing quote
      push("string", out, startLine, startColumn);
      continue;
    }

    // --- numbers --------------------------------------------------------
    if (isDigit(ch) || (ch === "." && isDigit(source[i + 1]))) {
      let out = "";
      while (i < source.length && (isDigit(source[i]) || source[i] === ".")) {
        out += source[i];
        advance();
      }
      if (i < source.length && /[eE]/.test(source[i])) {
        out += source[i];
        advance();
        if (source[i] === "+" || source[i] === "-") {
          out += source[i];
          advance();
        }
        while (i < source.length && isDigit(source[i])) {
          out += source[i];
          advance();
        }
      }
      push("number", out, startLine, startColumn);
      continue;
    }

    // --- identifiers ----------------------------------------------------
    if (isIdentStart(ch)) {
      let out = "";
      while (i < source.length && isIdentPart(source[i])) {
        out += source[i];
        advance();
      }
      push("ident", out, startLine, startColumn);
      continue;
    }

    // --- punctuation ----------------------------------------------------
    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct) {
      advance(punct.length);
      push("punct", punct, startLine, startColumn);
      continue;
    }

    fail(`Unexpected character ${JSON.stringify(ch)}`, startLine, startColumn);
  }

  push("eof", "", line, column);
  return tokens;
}
