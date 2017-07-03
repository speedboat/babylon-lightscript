var p = require("./")

var code = "a b;"
var result = p.parse(code, {plugins:['lightscript', 'decorators', 'transform-async-to-generator', 'flow', 'transform-class-properties', 'transform-decorators-legacy']})

delete result.tokens
delete result.comments
console.log(JSON.stringify(result, null, 2))