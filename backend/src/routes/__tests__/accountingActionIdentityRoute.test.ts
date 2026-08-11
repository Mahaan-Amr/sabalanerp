import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test, { TestContext } from 'node:test';
import express from 'express';
import { createAccountingActionHandler } from '../accounting';
import type { executeAccountingAction } from '../../services/accountingService';

const startAccountingActionRoute = async (context: TestContext) => {
  const commands: Array<Record<string, unknown>> = [];
  const executeAction: typeof executeAccountingAction = async (command) => {
    commands.push(command as unknown as Record<string, unknown>);
    return { actionId: 'test-action', status: 'APPLIED', messageFa: 'ثبت شد', affected: {} };
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      user: { id: 'accountant-1', role: 'ACCOUNTANT', username: 'accountant' },
      workspace: 'accounting',
      workspacePermission: 'admin',
      featurePermission: 'manage',
    });
    next();
  });
  app.post('/api/accounting/actions', createAccountingActionHandler(executeAction));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return {
    commands,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
};

test('Accounting actions accept the shared mutation identity headers at the production HTTP handler', async (context) => {
  const { commands, origin } = await startAccountingActionRoute(context);
  const response = await fetch(`${origin}/api/accounting/actions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-idempotency-key': 'approval-attempt-1132',
      'idempotency-key': 'legacy-attempt-must-not-win',
      'x-correlation-id': 'approval-request-1132',
    },
    body: JSON.stringify({ kind: 'APPROVE_FINANCIAL_INVOICE' }),
  });

  assert.equal(response.status, 200);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].idempotencyKey, 'approval-attempt-1132');
  assert.equal(commands[0].correlationId, 'approval-request-1132');
});

test('Accounting action identities preserve legacy headers and body fallbacks', async (context) => {
  const { commands, origin } = await startAccountingActionRoute(context);
  await fetch(`${origin}/api/accounting/actions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'legacy-approval-attempt',
      'x-correlation-id': 'header-correlation',
    },
    body: JSON.stringify({
      kind: 'APPROVE_FINANCIAL_INVOICE',
      idempotencyKey: 'body-idempotency',
      correlationId: 'body-correlation',
    }),
  });
  await fetch(`${origin}/api/accounting/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'APPROVE_FINANCIAL_INVOICE',
      idempotencyKey: 'body-idempotency',
      correlationId: 'body-correlation',
    }),
  });

  assert.equal(commands.length, 2);
  assert.equal(commands[0].idempotencyKey, 'legacy-approval-attempt');
  assert.equal(commands[0].correlationId, 'header-correlation');
  assert.equal(commands[1].idempotencyKey, 'body-idempotency');
  assert.equal(commands[1].correlationId, 'body-correlation');
});
