const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('./backend/node_modules/typescript');
const files = ['uploads', 'products', 'hr-hiring', 'hr-duties', 'security', 'support-tickets'];
for (const name of files) {
  const file = path.join(process.cwd(), 'backend/src/routes', name + '.ts');
  const text = fs.readFileSync(file, 'utf8'), newline = text.includes('\r\n') ? '\r\n' : '\n';
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits = []; let stores = 0, calls = 0, imported = false;
  function visit(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'multer') {
      assert.equal(imported, false); imported = true;
      edits.push({ start: node.end, end: node.end, replacement: newline + "import { createDurableUpload } from '../services/durableUpload';" });
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === 'multer' && node.expression.name.text === 'diskStorage') {
      assert.equal(node.arguments.length, 1); const options = node.arguments[0]; assert.ok(ts.isObjectLiteralExpression(options));
      edits.push({ start: node.getStart(source), end: options.getStart(source), replacement: '' });
      edits.push({ start: options.end, end: node.end, replacement: '' }); stores++;
      if (ts.isVariableDeclaration(node.parent)) {
        assert.equal(node.parent.type, undefined);
        edits.push({ start: node.parent.name.end, end: node.parent.name.end, replacement: ': multer.DiskStorageOptions' });
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'multer') {
      assert.equal(node.arguments.length, 1); assert.ok(ts.isObjectLiteralExpression(node.arguments[0]));
      edits.push({ start: node.expression.getStart(source), end: node.expression.end, replacement: 'createDurableUpload' }); calls++;
    }
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(imported && stores >= 1 && calls >= 1);
  let updated = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.replacement + updated.slice(edit.end);
  fs.writeFileSync(file, updated);
  console.log(JSON.stringify({ route: name, stores, calls }));
}
