import Parser from "../parser";
import { types as tt } from "../tokenizer/types";

let pp = Parser.prototype;


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

pp.maybeParseColonConstId = function () {
  if (!this.isPossibleColonConst()) return null;

  let id = this.startNode();
  try {
    this.parseVarHead(id);
  } catch (err) {
    return null;
  }

  if (!(this.eat(tt.colonEq) || this.isTypedColonConst(id))) return null;

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

// copy/paste from parseForIn, minus the forAwait and parenR expectation
// TODO: consider handling forAwait

pp.parseParenFreeForIn = function (node, init) {
  let type = this.match(tt._in) ? "ForInStatement" : "ForOfStatement";
  this.next();
  node.left = init;
  node.right = this.parseExpression();
  // does not expect paren
  node.body = this.parseStatement(false);
  this.state.labels.pop();
  return this.finishNode(node, type);
};

export default function (instance) {

  // if, switch, while, with --> don't need no stinkin' parens no more
  // (do-while still needs them)

  instance.extend("parseParenExpression", function (inner) {
    return function () {
      if (this.match(tt.parenL)) return inner.apply(this, arguments);

      let val = this.parseExpression();

      // enforce brace, so you can't do `if true return`
      // TODO: reconsider restriction
      // TODO: consider bailing to native impl
      if (!this.match(tt.braceL)) {
        this.unexpected(
          this.state.pos,
          "Paren-free test expressions must be followed by braces. " +
          "Consider wrapping your condition in parens."
        );
      }

      return val;
    };
  });

  // allow paren-free for-in/for-of
  // (ultimately, it will probably be cleaner to completely replace main impl, disallow parens)

  instance.extend("parseForStatement", function (inner) {
    return function (node) {
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

      // copypasta from original parseForStatement
      this.state.labels.push({kind: "loop"});
      if (this.match(tt._var) || this.match(tt._let) || this.match(tt._const)) {
        let init = this.startNode(), varKind = this.state.type;
        this.next();
        this.parseVar(init, true, varKind);
        this.finishNode(init, "VariableDeclaration");

        if (this.match(tt._in) || this.isContextual("of")) {
          if (init.declarations.length === 1 && !init.declarations[0].init) {
            return this.parseParenFreeForIn(node, init);
          }
        }
      }
      this.unexpected();
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
}
