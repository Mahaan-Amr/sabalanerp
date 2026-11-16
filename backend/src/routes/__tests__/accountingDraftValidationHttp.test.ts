import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import router, { createAccountingActionHandler } from '../accounting';
import type { executeAccountingAction } from '../../services/accountingService';

test('draft saves accept incomplete values while approval rejects nonnumeric amounts at the HTTP boundary', async t => {
  const commands: any[] = [];
  const execute: typeof executeAccountingAction = async command => {
    commands.push(command);
    return { actionId: 'test', status: 'APPLIED', messageFa: 'ثبت شد', affected: {} };
  };
  const route = (router as any).stack.find((layer: any) => layer.route?.path === '/actions' && layer.route.methods.post).route;
  const validators = route.stack.slice(3, -1).map((layer: any) => layer.handle);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { user: { id: 'accountant', role: 'ADMIN' }, workspace: 'accounting', workspacePermission: 'admin', featurePermission: 'manage' }); next(); });
  app.post('/actions', ...validators, createAccountingActionHandler(execute));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (body: object) => fetch(`${origin}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send({ kind: 'SAVE_INVOICE_DRAFT', invoiceId: 'invoice', sepidarAmount: '' })).status, 200);
  assert.equal((await send({ kind: 'SAVE_INVOICE_DRAFT', invoiceId: 'invoice', sepidarAmount: {} })).status, 400);
  assert.equal((await send({ kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId: 'invoice', sepidarAmount: '' })).status, 400);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].sepidarAmount, '');
});
