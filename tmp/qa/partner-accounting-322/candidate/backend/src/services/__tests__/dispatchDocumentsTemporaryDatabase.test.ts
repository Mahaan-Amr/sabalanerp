import assert from 'node:assert/strict';
import { assertSabalanerpLocalPostgres } from './dispatchDocumentsTemporaryDatabase';

const healthy = JSON.stringify({ Project: 'sabalanerp-local', Service: 'postgres',
  Name: 'sabalanerp-local-postgres-1', State: 'running', Health: 'healthy' });

assert.doesNotThrow(() => assertSabalanerpLocalPostgres(healthy));
assert.throws(() => assertSabalanerpLocalPostgres(JSON.stringify({ Project: 'other-project', Service: 'postgres',
  Name: 'other-project-postgres-1', State: 'running', Health: 'healthy' })), /sabalanerp-local postgres/);
assert.throws(() => assertSabalanerpLocalPostgres(JSON.stringify({ Project: 'sabalanerp-local', Service: 'postgres',
  Name: 'sabalanerp-local-postgres-1', State: 'exited', Health: '' })), /sabalanerp-local postgres/);

console.log('dispatch document temporary database preflight tests passed');
