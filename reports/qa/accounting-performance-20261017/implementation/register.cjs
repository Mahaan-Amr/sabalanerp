// Local diagnostic runner for the existing production-dependency Docker image.
const fs = require('node:fs');
const ts = require('/app/accounting-qa-tools/typescript.js');
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  if (/^(\.\.\/)+packages\/partner-sales-contracts$/.test(request)) request = '@sabalanerp/partner-sales-contracts';
  return resolve.call(this, request, parent, ...args);
};
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
  }, fileName: filename }).outputText;
  module._compile(output, filename);
};
