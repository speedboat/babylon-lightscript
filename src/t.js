/*require("babel-core/register")({
  "presets": [
    ["es2015"],
    "stage-0"
  ],
  "plugins": [
    "transform-flow-strip-types"
  ]
});*/
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
   result = parser.parse(code.trim(), {
    plugins: [
      "lightscript",
      "flow",
      "jsx"
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
 

process.on('exit', (code) => {
    // this force terminates the debugger by attaching to the debugger socket via it's FD and destroying it!
    try {
        new require('net').Socket({
            fd: parseInt(
                require('child_process').spawnSync('lsof', ['-np', process.pid], {encoding:'utf8'})
                    .stdout.match(/^.+?\sTCP\s+127.0.0.1:\d+->127.0.0.1:\d+\s+\(ESTABLISHED\)/m)[0].split(/\s+/)[3]
                , 10)
        }).destroy();
    } catch(e) {}
});

console.log(JSON.stringify(result, null, 2));