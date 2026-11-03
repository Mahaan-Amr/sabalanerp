// Test-only loader for the existing local container, which includes TypeScript
// but no tsx. Type checking is a separate required command, never implied here.
const fs = require('node:fs');
const ts = require('../../../frontend/node_modules/typescript');
require.extensions['.ts'] = function (module, filename) {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};
