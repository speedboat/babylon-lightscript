import Parser from "../parser";
import { types as tt } from "../tokenizer/types";

let pp = Parser.prototype;
const loopLabel = {kind: "loop"};

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

  let id = this.startNode();
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

const WORD_OPERATORS = {
  "or": "||",
  "and": "&&",
  "is": "===",
  "isnt": "!==",
  "not": "!",
};

pp.rewriteWordOperator = function (node) {
  if (WORD_OPERATORS[node.operator]) {
    node.operator = WORD_OPERATORS[node.operator];
  }
};

// for i of x
// for i in x
// for { i } of x
// for let i of x
// for i from x
// for i, x from y
// for 0 til 10
// for zero til ten
// for i from 0 til 10
// for let i = 0; i < len; i++

pp.parseParenFreeForStatement = function (node, inComprehension = false) {
  // ...was copypasta from original parseForStatement
  this.state.labels.push(loopLabel);

  if (this.match(tt.semi)) {
    return this.parseParenFreeFor(node, null, inComprehension);
  }

  let init;
  if (this.match(tt._var) || this.match(tt._let) || this.match(tt._const)) {
    let varKind = this.state.type;
    init = this.startNode();
    this.next();
    this.parseVar(init, true, varKind);
    this.finishNode(init, "VariableDeclaration");
  } else if (this.isPossibleColonConst()) {
    let { type, value } = this.lookahead();

    if (type === tt._in || value === "of") {
      // identifier auto-const in for-in/of
      init = this.startNode();
      init.kind = "const";
      let decl = this.startNode();
      this.parseVarHead(decl);
      this.finishNode(decl, "VariableDeclarator");
      init.declarations = [decl];
      this.finishNode(init, "VariableDeclaration");
    } else if (type === tt.comma || value === "from") {
      // for-from-array
      init = this.parseIdentifier();
    } else if (value === "til") {
      // for-til with identifiers instead of numbers
      init = this.parseIdentifier();
    } else {
      // might be destructured auto-const with for-of
      // (handle separately from name b/c perf and unified with for-in)
      init = this.startNode();
      let state = this.state.clone();
      let id = this.maybeParseColonConstId(true);

      if (id) {
        this.finishNode(id, "VariableDeclarator");
        init.kind = "const";
        init.declarations = [id];
        this.finishNode(init, "VariableDeclaration");
      } else {
        // for-til with an expression instead of identifier or number
        // TODO: consider dropping support for this, enforcing either number or variable...
        this.state = state; state = this.state.clone();
        init = this.parseExpression();
        if (!this.match(tt._til)) {
          this.state = state;
          this.unexpected();
        }
      }
    }
  } else {
    // for 0 til 10
    init = this.parseExpression();
  }

  if (this.match(tt._in) || this.isContextual("of")) {
    if (init.declarations.length === 1 && !init.declarations[0].init) {
      return this.parseParenFreeForIn(node, init, inComprehension);
    } else {
      // not sure what should happen here, I think it's unexpected...
      this.unexpected();
    }
  }

  if (this.match(tt.semi)) {
    return this.parseParenFreeFor(node, init, inComprehension);
  }

  // for i from
  //       ^
  // for 0 til
  //       ^
  // for i, x from
  //      ^
  return this.parseForFrom(node, init, inComprehension);
};

// copy/paste from parseForIn, minus the forAwait and parenR expectation
// TODO: consider handling forAwait

pp.parseParenFreeForIn = function (node, init, inComprehension) {
  let type = this.match(tt._in) ? "ForInStatement" : "ForOfStatement";
  this.next();
  node.left = init;
  node.right = this.parseExpression();
  node.body = this.parseParenFreeBody(inComprehension);
  this.state.labels.pop();
  return this.finishNode(node, type);
};

// largely copypasta, look for opening brace instead of closing paren

pp.parseParenFreeFor = function (node, init, inComprehension) {
  node.init = init;
  this.expect(tt.semi);
  node.test = this.match(tt.semi) ? null : this.parseExpression();
  this.expect(tt.semi);
  node.update = this.match(tt.parenR) ? null : this.parseExpression();
  node.body = this.parseParenFreeBody(inComprehension);
  this.state.labels.pop();
  return this.finishNode(node, "ForStatement");
};

pp.parseParenFreeBody = function (inComprehension) {
  this.expectParenFreeBlockStart();

  if (inComprehension) {
    return this.parseComprehensionStatement();
  } else {
    return this.parseStatement(false);
  }
};

pp.expectParenFreeBlockStart = function () {
  // if true: blah
  // if true { blah }
  if (!(this.match(tt.colon) || this.match(tt.braceL))) {
    this.unexpected(null, "Paren-free test expressions must be followed by braces or a colon.");
  }
};

// for i from 0 til 10
// for 0 til 10
// for i from array
// for i, val from array

pp.parseForFrom = function (node, init, inComprehension) {
  // (only identifiers for now, no destructuring)
  // will need to construct into VariableDeclaration in babel plugin
  if (this.eat(tt.comma)) {
    node.elem = this.parseIdentifier();
  }

  if (this.isContextual("from")) {
    node.id = init;
    this.next();

    let arrayOrRangeStart = this.parseExpression(true);
    if (this.eat(tt._til)) {
      if (node.elem) this.unexpected(node.elem.start, "Cannot use elem with ranges");

      node.rangeStart = arrayOrRangeStart;
      node.rangeEnd = this.parseExpression(true);
    } else {
      if (init.type !== "Identifier") this.unexpected();

      node.array = arrayOrRangeStart;
    }
  } else {
    // for 0 til 10
    this.expect(tt._til);

    if (node.elem) this.unexpected(node.elem.start, "Cannot use elem with ranges");
    if (init.type === "SequenceExpression") {
      this.unexpected(init.expressions[0].end + 1, "Cannot use elem with ranges");
    }

    node.rangeStart = init;
    node.rangeEnd = this.parseExpression(true);
  }

  node.body = this.parseParenFreeBody(inComprehension);

  this.state.labels.pop();
  return this.finishNode(node, "ForFromStatement");
};

// [for ...: stmnt]

pp.parseArrayComprehension = function (node) {
  let loop = this.startNode();
  this.next();
  node.loop = this.parseParenFreeForStatement(loop, true);
  this.expect(tt.bracketR);
  return this.finishNode(node, "ArrayComprehension");
};

// extreme simplification of parseStatement
// only allow for, if, and ExpressionStatement (without semicolon)

pp.parseComprehensionStatement = function () {
  this.expect(tt.colon);
  let node = this.startNode();

  if (this.eat(tt._for)) {
    return this.parseParenFreeForStatement(node, true);
  } else if (this.match(tt._if)) {
    return this.parseComprehensionIfStatement(node);
  }

  let expr = this.parseExpression();
  return this.parseComprehensionExpressionStatement(node, expr);
};

// c/p parseIfStatement looking for ComprehensionStatement, no else.

pp.parseComprehensionIfStatement = function (node) {
  this.next();
  node.test = this.parseParenExpression();
  node.consequent = this.parseComprehensionStatement(false);
  if (this.eat(tt._else)) this.unexpected(null, "else is not allowed in comprehensions (yet)");
  return this.finishNode(node, "IfStatement");
};

// c/p parseExpressionStatement without semicolon check

pp.parseComprehensionExpressionStatement = function (node, expr) {
  node.expression = expr;
  return this.finishNode(node, "ExpressionStatement");
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
  let num = parseInt(numStr, 10);

  // must also remove "." from the "raw" property,
  // b/c that's what's inserted in code

  let node = this.parseLiteral(num, "NumericLiteral");
  if (node.extra.raw.indexOf(".") === 0) {
    node.extra.raw = node.extra.raw.slice(1);
  } else {
    this.unexpected();
  }

  return node;
};

// c/p parseBlock

pp.parseWhiteBlock = function (allowDirectives?) {
  let node = this.startNode(), indentLevel = this.state.indentLevel;

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

    let stmt = this.parseStatement(true, false);

    if (allowDirectives && !parsedNonDirective &&
        stmt.type === "ExpressionStatement" && stmt.expression.type === "StringLiteral" &&
        !stmt.expression.extra.parenthesized) {
      let directive = this.stmtToDirective(stmt);
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
  let ch = this.state.input.charCodeAt(pos);
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
  let indentLevel = this.indentLevelAt(pos);
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
      let val = this.parseExpression();
      this.expectParenFreeBlockStart();
      return val;
    };
  });

  // allow paren-free for-in/for-of
  // (ultimately, it will probably be cleaner to completely replace main impl, disallow parens)

  instance.extend("parseForStatement", function (inner) {
    return function (node) {
      // TODO: just get rid of native impl, require paren-free...
      let state = this.state.clone();
      this.next();

      // `for` `(` or `for` `await`
      // TODO: consider implementing paren-free for-await-of
      if (this.match(tt.parenL) || (
        this.hasPlugin("asyncGenerators") && this.isContextual("await")
      )) {
        this.state = state;
        return inner.apply(this, arguments);
      }

      return this.parseParenFreeForStatement(node);
    };
  });

  // if exporting an implicit-const, don't parse as default.

  instance.extend("parseStatement", function (inner) {
    return function () {
      if (this.match(tt.braceL)) {
        let state = this.state.clone();
        let node = this.startNode();

        let id = this.maybeParseColonConstId();
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
      let state = this.state.clone();
      this.next();
      let decl = this.startNode();
      let id = this.maybeParseColonConstId();

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
