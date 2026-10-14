/**
 * Shared error types and a small diagnostic formatter for MeowScript.
 */

export class MeowError extends Error {
  /**
   * @param {string} message
   * @param {{line?: number, column?: number, file?: string, source?: string}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = "MeowError";
    this.line = info.line;
    this.column = info.column;
    this.file = info.file;
    this.source = info.source;
  }

  /** Human readable, single/multi-line diagnostic with a source caret. */
  format() {
    const where = this.file ? `${this.file}` : "<input>";
    const loc =
      this.line != null ? `${where}:${this.line}:${this.column ?? 0}` : where;
    const head = `${this.name}: ${this.message}\n  --> ${loc}`;
    if (this.source && this.line != null) {
      const lines = this.source.split(/\r?\n/);
      const text = lines[this.line - 1];
      if (text != null) {
        const caret = " ".repeat(Math.max(0, (this.column ?? 1) - 1)) + "^";
        return `${head}\n${this.line} | ${text}\n${" ".repeat(String(this.line).length)} | ${caret}`;
      }
    }
    return head;
  }
}

export class LexError extends MeowError {
  constructor(message, info) {
    super(message, info);
    this.name = "LexError";
  }
}

export class ParseError extends MeowError {
  constructor(message, info) {
    super(message, info);
    this.name = "ParseError";
  }
}

export class CompileError extends MeowError {
  constructor(message, info) {
    super(message, info);
    this.name = "CompileError";
  }
}
