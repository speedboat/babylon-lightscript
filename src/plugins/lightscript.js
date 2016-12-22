import Parser from "../parser";
import { types as tt } from "../tokenizer/types";

const pp = Parser.prototype;

// mostly a simplified dup of parseVar and parseVarStatement

pp.parseColonEq = function(node, decl, isFor) {
  node.kind = "const";

  decl.init = this.parseMaybeAssign(isFor);
  node.declarations = [this.finishNode(decl, "VariableDeclarator")];

  this.semicolon();

  return this.finishNode(node, "VariableDeclaration");
};

pp.isColonConstAssign = function (expr) {
  return (
    expr.type === "AssignmentExpression" &&
    (expr.operator === ":=" || expr.left.typeAnnotation)
  );
};

pp.rewriteAssignmentAsDeclarator = function (node) {
  node.type = "VariableDeclarator";
  node.id = node.left;
  node.init = node.right;
  delete node.left;
  delete node.operator;
  delete node.right;
  return node;
};

// Must unwind state after calling this!
// TODO: remove completely, and replace with a non-lookahead solution for perf.

pp.maybeParseColonConstId = function (isForOf) {
  if (!this.isPossibleColonConst()) return null;

  const id = this.startNode();
  try {
    this.parseVarHead(id);
  } catch (err) {
    return null;
  }

  // if for-of, require, but do not eat, `of`
  // else, require and eat `:=` or `: Type =`
  if (isForOf) {
    if (!this.isContextual("of")) return null;
  } else if (!(this.eat(tt.colonEq) || this.isTypedColonConst(id))) {
    return null;
  }

  return id;
};

pp.isPossibleColonConst = function () {
  return (
    this.match(tt.name) ||
    this.match(tt.braceL) ||
    this.match(tt.bracketL)
  );
};

pp.isTypedColonConst = function (decl) {
  return (
    this.hasPlugin("flow") &&
    decl.id.typeAnnotation &&
    (this.eat(tt.eq) || this.eat(tt.colonEq))
  );
};

const REMAPPED_OPERATORS = {
  "!=": "!==",
  "==": "===",
  "or": "||",
  "and": "&&",
  "not": "!",
};

pp.rewriteOperator = function (node) {
  if (REMAPPED_OPERATORS[node.operator]) {
    node.operator = REMAPPED_OPERATORS[node.operator];
  }
};

pp.parseForFrom = function (node, iterator) {
  this.expectContextual("from");
  // `for i from`
  const arrayOrRangeStart = this.parseExpression(true);
  if (this.match(tt._thru) || this.match(tt._til)) {
    return this.parseForFromRange(node, iterator, arrayOrRangeStart);
  } else {
    return this.parseForFromArray(node, iterator, null, arrayOrRangeStart);
  }
};

pp.parseForFromArray = function (node, iterator, element = null, array = null) {
  if (iterator.type !== "Identifier") this.unexpected(iterator.start);
  if (element && element.type !== "Identifier") this.unexpected(element.start);
  node.id = iterator;
  node.elem = element;

  if (array) {
    node.array = array;
  } else {
    this.expectContextual("from");
    node.array = this.parseMaybeAssign(true);
  }

  this.expectParenFreeBlockStart();
  node.body = this.parseStatement(false);
  return this.finishNode(node, "ForFromArrayStatement");
};

pp.parseForFromRange = function (node, iterator = null, rangeStart = null) {
  if (iterator && iterator.type === "SequenceExpression") {
    this.unexpected(iterator.expressions[1].start, "Ranges only iterate over one variable.");
  }
  node.id = iterator;

  if (rangeStart) {
    // `for 0 til`
    if (rangeStart.type === "SequenceExpression") {
      this.unexpected(rangeStart.expressions[1].start, "Unexpected comma.");
    }
    node.rangeStart = rangeStart;
  } else {
    // `for i from 0 til`
    this.expectContextual("from");
    node.rangeStart = this.parseMaybeAssign(true);
  }

  if (this.eat(tt._thru)) {
    node.inclusive = true;
  } else {
    this.expect(tt._til);
    node.inclusive = false;
  }

  node.rangeEnd = this.parseMaybeAssign(true);
  this.expectParenFreeBlockStart();
  node.body = this.parseStatement(false);
  return this.finishNode(node, "ForFromRangeStatement");
};

pp.expectParenFreeBlockStart = function () {
  // if true: blah
  // if true { blah }
  // if (true) blah
  // TODO: ensure matching parens, not just allowing one on either side
  if (!(this.match(tt.colon) || this.match(tt.braceL) || this.eat(tt.parenR))) {
    this.unexpected(null, "Paren-free test expressions must be followed by braces or a colon.");
  }
};

// [for ...: stmnt]

pp.parseArrayComprehension = function (node) {
  const loop = this.startNode();
  node.loop = this.parseForStatement(loop);
  this.expect(tt.bracketR);
  return this.finishNode(node, "ArrayComprehension");
};

pp.isNumberStartingWithDot = function () {
  return (
    this.match(tt.num) &&
    this.state.input.charCodeAt(this.state.start) === 46  // "."
  );
};

// the tokenizer reads dots directly into numbers,
// so "x.1" is tokenized as ["x", .1] not ["x", ".", 1]
// therefore, we have to hack, reading the number back into a string
// and parsing out the dot.

pp.parseNumericLiteralMember = function () {
  // 0.1 -> 1, 0 -> 0
  let numStr = String(this.state.value);
  if (numStr.indexOf("0.") === 0) {
    numStr = numStr.slice(2);
  } else if (numStr !== "0") {
    this.unexpected();
  }
  const num = parseInt(numStr, 10);

  // must also remove "." from the "raw" property,
  // b/c that's what's inserted in code

  const node = this.parseLiteral(num, "NumericLiteral");
  if (node.extra.raw.indexOf(".") === 0) {
    node.extra.raw = node.extra.raw.slice(1);
  } else {
    this.unexpected();
  }

  return node;
};

// c/p parseBlock

pp.parseWhiteBlock = function (allowDirectives?) {
  const node = this.startNode(), indentLevel = this.state.indentLevel;

  // TODO: also ->, =>, others?
  if (!this.eat(tt.colon)) this.unexpected();

  if (!this.isLineTerminator()) {
    return this.parseStatement(false);
  }

  this.parseWhiteBlockBody(node, allowDirectives, indentLevel);
  if (!node.body.length) this.unexpected(node.start, "Expected an Indent or Statement");

  return this.finishNode(node, "BlockStatement");
};

// c/p parseBlockBody, but indentLevel instead of end (and no topLevel)

pp.parseWhiteBlockBody = function (node, allowDirectives, indentLevel) {
  node.body = [];
  node.directives = [];

  let parsedNonDirective = false;
  let oldStrict;
  let octalPosition;

  while (this.state.indentLevel > indentLevel && !this.match(tt.eof)) {
    if (!parsedNonDirective && this.state.containsOctal && !octalPosition) {
      octalPosition = this.state.octalPosition;
    }

    const stmt = this.parseStatement(true, false);

    if (allowDirectives && !parsedNonDirective &&
        stmt.type === "ExpressionStatement" && stmt.expression.type === "StringLiteral" &&
        !stmt.expression.extra.parenthesized) {
      const directive = this.stmtToDirective(stmt);
      node.directives.push(directive);

      if (oldStrict === undefined && directive.value.value === "use strict") {
        oldStrict = this.state.strict;
        this.setStrict(true);

        if (octalPosition) {
          this.raise(octalPosition, "Octal literal in strict mode");
        }
      }

      continue;
    }

    parsedNonDirective = true;
    node.body.push(stmt);
  }

  if (oldStrict === false) {
    this.setStrict(false);
  }
};

pp.expectCommaOrLineBreak = function () {
  // TODO: consider error message like "Missing comma or newline."
  if (!(this.eat(tt.comma) || this.isLineBreak())) this.unexpected(null, tt.comma);
};

// lightscript only allows plain space (ascii-32), \r\n, and \n.
// note that the space could appear within a string.

pp.isWhitespaceAt = function (pos) {
  const ch = this.state.input.charCodeAt(pos);
  return (ch === 32 || ch === 13 || ch === 10);
};

pp.isNextCharWhitespace = function () {
  return this.isWhitespaceAt(this.state.end);
};

// detect whether we're on a (non-indented) newline
// relative to another position, eg;
// x y -> false
// x\ny -> true
// x\n  y -> false

pp.isNonIndentedBreakFrom = function (pos) {
  const indentLevel = this.indentLevelAt(pos);
  return this.isLineBreak() && this.state.indentLevel <= indentLevel;
};

// walk backwards til newline or start-of-file.
// if two consecutive spaces are found together, increment indents.
// if non-space found, reset indentation.

pp.indentLevelAt = function (pos) {
  let indents = 0;
  while (pos > 0 && this.state.input[pos] !== "\n") {
    if (this.state.input[pos--] === " ") {
      if (this.state.input[pos] === " ") {
        --pos;
        ++indents;
      }
    } else {
      indents = 0;
    }
  }
  return indents;
};


export default function (instance) {

  // if, switch, while, with --> don't need no stinkin' parens no more

  instance.extend("parseParenExpression", function (inner) {
    return function () {
      if (this.match(tt.parenL)) return inner.apply(this, arguments);
      const val = this.parseExpression();
      this.expectParenFreeBlockStart();
      return val;
    };
  });

  // if exporting an implicit-const, don't parse as default.

  instance.extend("parseStatement", function (inner) {
    return function () {
      if (this.match(tt.braceL)) {
        const state = this.state.clone();
        const node = this.startNode();

        const id = this.maybeParseColonConstId();
        if (id) {
          return this.parseColonEq(node, id);
        } else {
          this.state = state;
        }
      }
      return inner.apply(this, arguments);
    };
  });

  // also for `:=`, since `export` is the only time it can be preceded by a newline.

  instance.extend("parseExport", function (inner) {
    return function (node) {
      const state = this.state.clone();
      this.next();
      const decl = this.startNode();
      const id = this.maybeParseColonConstId();

      if (id) {
        node.specifiers = [];
        node.source = null;
        node.declaration = this.parseColonEq(decl, id);
        this.checkExport(node, true);
        return this.finishNode(node, "ExportNamedDeclaration");
      } else {
        this.state = state;
        return inner.apply(this, arguments);
      }
    };
  });

  // whitespace following a colon

  instance.extend("parseStatement", function (inner) {
    return function () {
      if (this.match(tt.colon)) {
        return this.parseWhiteBlock();
      }
      return inner.apply(this, arguments);
    };
  });

  // whitespace following a colon

  instance.extend("parseBlock", function (inner) {
    return function (allowDirectives) {
      if (this.match(tt.colon)) {
        return this.parseWhiteBlock(allowDirectives);
      }
      return inner.apply(this, arguments);
    };
  });
}
