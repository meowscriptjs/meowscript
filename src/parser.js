/**
 * MeowScript parser.
 *
 * Recursive-descent parser turning a token stream into a small, explicit AST.
 * MeowScript is intentionally context-free: keywords are recognised by shape
 * (`sprite "..."`, `when <event>`, `let ...`) rather than being reserved words.
 */
import { tokenize } from "./lexer.js";
import { ParseError } from "./errors.js";

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/="]);
const PROPERTY_KEYS = new Set(["layer", "costumes", "sounds"]);

class Parser {
  /**
   * @param {import('./lexer.js').Token[]} tokens
   * @param {string} source
   * @param {string} file
   */
  constructor(tokens, source, file) {
    this.tokens = tokens;
    this.source = source;
    this.file = file;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next() {
    return this.tokens[this.pos++];
  }

  at(value, type) {
    const tok = this.peek();
    if (type && tok.type !== type) return false;
    return tok.value === value;
  }

  atIdent(value) {
    const tok = this.peek();
    return tok.type === "ident" && tok.value === value;
  }

  atPunct(value) {
    const tok = this.peek();
    return tok.type === "punct" && tok.value === value;
  }

  eat(value, type) {
    if (this.at(value, type)) {
      return this.next();
    }
    return null;
  }

  expect(value, type) {
    if (this.at(value, type)) return this.next();
    this.fail(
      `Expected ${JSON.stringify(value)} but found ${this.describe(this.peek())}`,
    );
  }

  expectIdent() {
    const tok = this.peek();
    if (tok.type !== "ident")
      this.fail(`Expected an identifier but found ${this.describe(tok)}`);
    return this.next().value;
  }

  expectType(type, what = type) {
    const tok = this.peek();
    if (tok.type !== type)
      this.fail(`Expected ${what} but found ${this.describe(tok)}`);
    return this.next();
  }

  describe(tok) {
    if (tok.type === "eof") return "end of file";
    if (tok.type === "string") return `string ${JSON.stringify(tok.value)}`;
    return JSON.stringify(tok.value);
  }

  fail(message, tok = this.peek()) {
    throw new ParseError(message, {
      file: this.file,
      line: tok.line,
      column: tok.column,
      source: this.source,
    });
  }

  // ------------------------------------------------------------------ core

  parse() {
    const sprites = [];
    let stage = null;
    const topItems = [];

    while (this.peek().type !== "eof") {
      if (this.atIdent("sprite") && this.peek(1).type === "string") {
        sprites.push(this.parseSprite());
      } else if (
        this.atIdent("stage") &&
        this.peek(1).type === "punct" &&
        this.peek(1).value === "{"
      ) {
        if (stage) this.fail("A project may only declare one stage");
        stage = this.parseStage();
      } else {
        topItems.push(this.parseBodyItem());
      }
    }

    return { type: "Program", stage, sprites, topItems };
  }

  parseSprite() {
    const tok = this.expect("sprite");
    const name = this.expectType("string", "a sprite name string").value;
    const body = this.parseBlockBody();
    return { type: "SpriteDecl", name, body, loc: tok };
  }

  parseStage() {
    const tok = this.expect("stage");
    const body = this.parseBlockBody();
    return { type: "StageDecl", name: "Stage", body, loc: tok };
  }

  parseBlockBody() {
    this.expect("{");
    const items = [];
    while (!this.atPunct("}")) {
      if (this.peek().type === "eof")
        this.fail('Unterminated block; expected "}"');
      items.push(this.parseBodyItem());
    }
    this.expect("}");
    return items;
  }

  parseBodyItem() {
    const tok = this.peek();

    if (tok.type === "ident") {
      switch (tok.value) {
        case "let":
          return this.parseVarDecl(false);
        case "cloud":
          if (this.peek(1).type === "ident" && this.peek(1).value === "let") {
            return this.parseVarDecl(true);
          }
          break;
        case "list":
          if (this.peek(1).type === "ident") {
            return this.parseListDecl();
          }
          break;
        case "function":
          return this.parseFunctionDecl(false, false);
        case "returning":
          if (
            this.peek(1).type === "ident" &&
            this.peek(1).value === "function"
          ) {
            return this.parseFunctionDecl(true, false);
          }
          break;
        case "warp":
          if (
            this.peek(1).type === "ident" &&
            this.peek(1).value === "function"
          ) {
            return this.parseFunctionDecl(false, true);
          }
          break;
        case "when":
          return this.parseHat();
        case "if":
          return this.parseIf();
        case "repeat":
          return this.parseRepeat();
        case "while":
          return this.parseWhile();
        case "forever":
          return this.parseForever();
        case "return":
          return this.parseReturn();
        default:
          break;
      }

      if (
        PROPERTY_KEYS.has(tok.value) &&
        this.peek(1).type === "punct" &&
        this.peek(1).value === ":"
      ) {
        return this.parseProperty();
      }
    }

    return this.parseSimpleStatement();
  }

  parseVarDecl(cloud) {
    const tok = cloud ? this.expect("cloud") : this.expect("let");
    if (cloud) this.expect("let");
    const name = this.expectIdent();
    let init = null;
    if (this.eat("=")) init = this.parseExpression();
    this.expect(";");
    return { type: "VarDecl", name, init, cloud, loc: tok };
  }

  parseListDecl() {
    const tok = this.expect("list");
    const name = this.expectIdent();
    let items = [];
    if (this.eat("=")) {
      this.expect("[");
      items = this.parseExpressionList("]");
      this.expect("]");
    }
    this.expect(";");
    return { type: "ListDecl", name, items, loc: tok };
  }

  parseFunctionDecl(returns, warp) {
    const tok = this.peek();
    if (this.atIdent("returning")) this.next();
    if (this.atIdent("warp")) this.next();
    this.expect("function");
    const name = this.expectIdent();
    this.expect("(");
    const params = [];
    while (!this.atPunct(")")) {
      const ptok = this.peek();
      let paramName = this.expectIdent();
      let boolean = false;
      // Optional type annotation: `flag: boolean`
      if (this.eat(":")) {
        const typeName = this.expectIdent();
        if (typeName === "boolean") boolean = true;
        else if (typeName !== "number" && typeName !== "string") {
          this.fail(`Unknown parameter type ${JSON.stringify(typeName)}`, ptok);
        }
      }
      params.push({ name: paramName, boolean });
      if (!this.eat(",")) break;
    }
    this.expect(")");
    const body = this.parseBlockBody();
    return {
      type: "FunctionDecl",
      name,
      params,
      returns,
      warp,
      body,
      loc: tok,
    };
  }

  parseHat() {
    const tok = this.expect("when");
    const event = this.parseCallOrIdentifier();
    const body = this.parseBlockBody();
    return { type: "HatDecl", event, body, loc: tok };
  }

  parseProperty() {
    const tok = this.peek();
    const key = this.expectIdent();
    this.expect(":");
    let value;
    if (this.atPunct("{")) {
      value = this.parseStringMap();
    } else {
      value = this.parseExpression();
    }
    this.expect(";");
    return { type: "PropertyDecl", key, value, loc: tok };
  }

  parseStringMap() {
    this.expect("{");
    const map = [];
    while (!this.atPunct("}")) {
      const keyTok = this.peek();
      let key;
      if (keyTok.type === "ident") key = this.next().value;
      else if (keyTok.type === "string") key = this.next().value;
      else
        this.fail(
          `Expected a costume/sound name but found ${this.describe(keyTok)}`,
        );
      this.expect(":");
      const valTok = this.expectType("string", "an asset path string");
      map.push({ key, value: valTok.value, loc: keyTok });
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return map;
  }

  // ------------------------------------------------------------ statements

  parseIf() {
    const tok = this.expect("if");
    let cond;
    if (this.eat("(")) {
      cond = this.parseExpression();
      this.expect(")");
    } else {
      cond = this.parseExpression();
    }
    const then = this.parseBlockBody();
    let elseBody = null;
    if (this.atIdent("else")) {
      this.next();
      if (this.atIdent("if")) {
        elseBody = [this.parseIf()];
      } else {
        elseBody = this.parseBlockBody();
      }
    }
    return { type: "If", cond, then, else: elseBody, loc: tok };
  }

  parseRepeat() {
    const tok = this.expect("repeat");
    let count;
    if (this.eat("(")) {
      count = this.parseExpression();
      this.expect(")");
    } else {
      count = this.parseExpression();
    }
    const body = this.parseBlockBody();
    return { type: "Repeat", count, body, loc: tok };
  }

  parseWhile() {
    const tok = this.expect("while");
    let cond;
    if (this.eat("(")) {
      cond = this.parseExpression();
      this.expect(")");
    } else {
      cond = this.parseExpression();
    }
    const body = this.parseBlockBody();
    return { type: "While", cond, body, loc: tok };
  }

  parseForever() {
    const tok = this.expect("forever");
    const body = this.parseBlockBody();
    return { type: "Forever", body, loc: tok };
  }

  parseReturn() {
    const tok = this.expect("return");
    let value = null;
    if (!this.atPunct(";")) value = this.parseExpression();
    this.expect(";");
    return { type: "Return", value, loc: tok };
  }

  parseSimpleStatement() {
    const tok = this.peek();
    const name = this.parseQualifiedName();

    // Assignment to a (possibly scoped) variable.
    if (
      name.segments.length === 1 &&
      this.peek().type === "punct" &&
      ASSIGN_OPS.has(this.peek().value)
    ) {
      const op = this.next().value;
      const value = this.parseExpression();
      this.expect(";");
      return { type: "Assign", name: name.segments[0], op, value, loc: tok };
    }

    let args = [];
    if (this.eat("(")) {
      args = this.parseExpressionList(")");
      this.expect(")");
    }

    let body = null;
    let elseBody = null;
    if (this.atPunct("{")) {
      body = this.parseBlockBody();
      if (this.atIdent("else")) {
        this.next();
        if (this.atIdent("if")) elseBody = [this.parseIf()];
        else elseBody = this.parseBlockBody();
      }
      this.eat(";");
    } else {
      this.expect(";");
    }
    return {
      type: "BlockCall",
      name: name.name,
      segments: name.segments,
      args,
      body,
      else: elseBody,
      loc: tok,
    };
  }

  parseCallOrIdentifier() {
    const name = this.parseQualifiedName();
    if (this.eat("(")) {
      const args = this.parseExpressionList(")");
      this.expect(")");
      return { name: name.name, segments: name.segments, args };
    }
    return { name: name.name, segments: name.segments, args: [] };
  }

  parseQualifiedName() {
    const tok = this.peek();
    const segments = [this.expectIdent()];
    while (this.atPunct(".") && this.peek(1).type === "ident") {
      this.next();
      segments.push(this.next().value);
    }
    return { name: segments.join("."), segments, loc: tok };
  }

  parseExpressionList(closing) {
    const list = [];
    if (this.atPunct(closing)) return list;
    list.push(this.parseExpression());
    while (this.eat(",")) {
      if (this.atPunct(closing)) break; // tolerate trailing comma
      list.push(this.parseExpression());
    }
    return list;
  }

  // ----------------------------------------------------------- expressions

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.atIdent("or") || this.atPunct("||")) {
      this.next();
      const right = this.parseAnd();
      left = { type: "Binary", op: "or", left, right, loc: left.loc };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.atIdent("and") || this.atPunct("&&")) {
      this.next();
      const right = this.parseNot();
      left = { type: "Binary", op: "and", left, right, loc: left.loc };
    }
    return left;
  }

  parseNot() {
    if (this.atIdent("not") || this.atPunct("!")) {
      const tok = this.next();
      const operand = this.parseNot();
      return { type: "Unary", op: "not", operand, loc: tok };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (
      this.peek().type === "punct" &&
      ["==", "!=", "<", "<=", ">", ">="].includes(this.peek().value)
    ) {
      const op = this.next().value;
      const right = this.parseAdditive();
      left = { type: "Binary", op, left, right, loc: left.loc };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (
      this.peek().type === "punct" &&
      (this.peek().value === "+" || this.peek().value === "-")
    ) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = { type: "Binary", op, left, right, loc: left.loc };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (
      this.peek().type === "punct" &&
      ["*", "/", "%"].includes(this.peek().value)
    ) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { type: "Binary", op, left, right, loc: left.loc };
    }
    return left;
  }

  parseUnary() {
    if (this.atPunct("-")) {
      const tok = this.next();
      const operand = this.parseUnary();
      if (operand.type === "Number") {
        return { type: "Number", value: -operand.value, loc: tok };
      }
      return { type: "Unary", op: "-", operand, loc: tok };
    }
    if (this.atPunct("+")) {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();

    if (tok.type === "number") {
      this.next();
      return { type: "Number", value: Number(tok.value), loc: tok };
    }
    if (tok.type === "string") {
      this.next();
      return { type: "String", value: tok.value, loc: tok };
    }
    if (tok.type === "punct" && tok.value === "(") {
      this.next();
      const expr = this.parseExpression();
      this.expect(")");
      return expr;
    }
    if (tok.type === "punct" && tok.value === "[") {
      this.next();
      const items = this.parseExpressionList("]");
      this.expect("]");
      return { type: "ArrayLiteral", items, loc: tok };
    }
    if (tok.type === "ident") {
      if (tok.value === "true" || tok.value === "false") {
        this.next();
        return { type: "Boolean", value: tok.value === "true", loc: tok };
      }
      const name = this.parseQualifiedName();
      if (this.eat("(")) {
        const args = this.parseExpressionList(")");
        this.expect(")");
        return {
          type: "Call",
          name: name.name,
          segments: name.segments,
          args,
          loc: tok,
        };
      }
      return {
        type: "Identifier",
        name: name.name,
        segments: name.segments,
        loc: tok,
      };
    }

    this.fail(`Unexpected ${this.describe(tok)} in expression`);
  }
}

/**
 * Parse a MeowScript source string into an AST.
 * @param {string} source
 * @param {string} [file]
 */
export function parse(source, file = "<input>") {
  const tokens = tokenize(source, file);
  return new Parser(tokens, source, file).parse();
}
