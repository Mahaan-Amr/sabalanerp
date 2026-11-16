import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runner=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('protected runner refuses a distinct database role selection before touching the host',()=>{
 const guard=runner.indexOf('Role-split deployment is unavailable');
 assert.ok(guard>0 && guard<runner.indexOf('cd "${REPO_ROOT}"'));
 assert.match(runner,/\$\{BACKEND_DATABASE_URL\+x\}/);
 assert.match(runner,/\$\{DEPLOYMENT_DATABASE_URL\+x\}/);
 assert.match(runner,/\$\{DEPLOYMENT_DATABASE_ROLE_SPLIT\+x\}/);
 assert.ok(guard<runner.indexOf('for command in git docker awk'));
 assert.match(runner,/awk '\/\^\[\[:space:\]\]\*\(export/);
 assert.match(runner,/BACKEND_DATABASE_URL\|DEPLOYMENT_DATABASE_URL\|DEPLOYMENT_DATABASE_ROLE_SPLIT/);
 assert.match(runner,/END \{ exit !found \}/);
});
