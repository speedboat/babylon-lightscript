const parser = require("./");
const path = require("path");
const fs = require("fs");

/*console.log = function() {
  let e = new Error()
  console.error(e.stack)
}*/
global.log = console.log.bind(this)

const p = process.argv[2]
if (!p) {
  throw new Error("Path argument required")
}

const sourceDir = path.resolve(process.cwd(), p);
const actual = path.join(sourceDir, "actual.js");
const exp = path.join(sourceDir, "expected.json");
const opt = path.join(sourceDir, "options.json");
if (fs.existsSync(exp)) {
  fs.unlinkSync(exp);
};
if (fs.existsSync(opt)) {
  fs.unlinkSync(opt);
}

const code = fs.readFileSync(actual, 'utf-8');
let result;
try {
   result = parser.parse(code, {
    plugins: [
      "lightscript",
      "decorators",
      "transform-async-to-generator",
      "flow",
      "jsx",
      "transform-class-properties",
      "transform-decorators-legacy"
    ]
  });
  delete result.tokens;
  delete result.comments;
  fs.writeFileSync(path.join(sourceDir, "expected.json"), JSON.stringify(result, null, 2));

} catch (e) {
  result = {
    throws: e.message
  }
  fs.writeFileSync(path.join(sourceDir, "options.json"), JSON.stringify(result, null, 2));
}
 



console.log(JSON.stringify(result, null, 2));