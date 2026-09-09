import assert from 'node:assert/strict';
import { assertDispatchDocumentsMigrationTarget, assertSabalanerpLocalPostgres } from './dispatchDocumentsTemporaryDatabase';

const healthy = JSON.stringify({ Project: 'sabalanerp-local', Service: 'postgres',
  Name: 'sabalanerp-local-postgres-1', State: 'running', Health: 'healthy' });

assert.doesNotThrow(() => assertSabalanerpLocalPostgres(healthy));
assert.throws(() => assertSabalanerpLocalPostgres(JSON.stringify({ Project: 'other-project', Service: 'postgres',
  Name: 'other-project-postgres-1', State: 'running', Health: 'healthy' })), /sabalanerp-local postgres/);
assert.throws(() => assertSabalanerpLocalPostgres(JSON.stringify({ Project: 'sabalanerp-local', Service: 'postgres',
  Name: 'sabalanerp-local-postgres-1', State: 'exited', Health: '' })), /sabalanerp-local postgres/);

const name = 'sabalanerp_dispatchdocs_0123456789abcdef';
const target = `postgresql://postgres:local@127.0.0.1:55432/${name}?schema=public&connection_limit=2&pool_timeout=10`;
assert.doesNotThrow(() => assertDispatchDocumentsMigrationTarget(target, name));
for (const unsafe of [
  target.replace(name, 'sabalanerp'),
  target.replace(name, 'sabalanerp_dispatchdocs_fedcba9876543210'),
  target.replace('127.0.0.1', 'remote.example.invalid'),
  target.replace('55432', '5432'),
  target.replace('schema=public', 'schema=private'),
  `${target}&schema=private`,
]) assert.throws(() => assertDispatchDocumentsMigrationTarget(unsafe, name), /exact temporary/);
assert.throws(() => assertDispatchDocumentsMigrationTarget(target, 'sabalanerp'), /unsafe/);

console.log('dispatch document temporary database preflight and migration-target tests passed');
