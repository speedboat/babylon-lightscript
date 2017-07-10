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
const l = process.argv[3]
const isModule = process.argv[4]

if (!p) {
  throw new Error("Path argument required")
}

const clearContents = function(dirPath) {
  const files = fs.readdirSync(dirPath);
  if (files.length > 0)
    for (var i = 0; i < files.length; i++) {
      var filePath = dirPath + '/' + files[i];
      if (fs.statSync(filePath).isFile() && (path.basename(filePath).indexOf("actual.js") == -1))
        fs.unlinkSync(filePath);
    }
};

const sourceDir = path.resolve(process.cwd(), p);
//clearContents(sourceDir);
const actual = path.join(sourceDir, "actual.js");

let exp, opt;

if (l) {
  exp = path.join(sourceDir, "expected.lightscript.json");
  opt = path.join(sourceDir, "options.lightscript.json");
} else {
  exp = path.join(sourceDir, "expected.json");
  opt = path.join(sourceDir, "options.json");
}

const code = fs.readFileSync(actual, 'utf-8');
let result;

const sourceType = isModule ? "module" : "script";

try {
   result = parser.parse(code.replace(/\n$/g, ""), {
    sourceType: sourceType,
    plugins: [
      "lightscript",
      "flow",
      "jsx",
      "decorators",
      "transform-async-to-generator",
      "transform-class-properties",
      "transform-decorators-legacy"
      //"asyncGenerators"
    ]
  });
  
  delete result.tokens;
  delete result.comments;
  fs.writeFileSync(exp, JSON.stringify(result, null, 2));

} catch (e) {
  if (process.env.DEBUG) {
    throw e;
  }
  result = {
    throws: e.message
  }
  fs.writeFileSync(opt, JSON.stringify(result, null, 2));
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