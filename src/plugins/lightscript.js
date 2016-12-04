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
  if (!(this.eat(tt.colon) && !this.isLineBreak() || this.match(tt.braceL) || this.eat(tt.parenR))) {
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
