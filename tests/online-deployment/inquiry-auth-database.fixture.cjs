const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

test('real Inquiry SQLite and signed sessions revoke changed or deleted accounts across the proxy reader', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-inquiry-session-db-'));
  const database = new PrismaClient({ datasources: { db: { url: `file:${root}/authority.db?connection_limit=1&pool_timeout=5` } } });
  const jose = await import(pathToFileURL('/app/node_modules/jose/dist/webapi/index.js').href);
  const secret = 'local-inquiry-authority-db-fixture-key-01234567890123456789';
  const jar = new Map();
  const replacements = {
    'next/headers': { cookies: async () => ({ get: name => jar.has(name) ? { value: jar.get(name) } : undefined,
      set: (name, value) => jar.set(name, value), delete: name => jar.delete(name) }) },
    'next/navigation': { redirect: target => { throw Error('REDIRECT:' + target); } },
    './prisma': { prisma: database },
    jose,
  };
  const exported = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'inquiry-auth.js'), 'utf8'), {
    exports: exported, require: name => replacements[name] || require(name), Buffer, TextEncoder,
    process: { env: { NODE_ENV: 'production', SESSION_SECRET: secret } },
  });
  try {
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'inquiry-baseline.json'), 'utf8'));
    for (const item of baseline.objects) await database.$executeRawUnsafe(item.sql);
    const passwordHash = await bcrypt.hash('local-session-qa-only-password', 4);
    for (const role of ['admin', 'user']) {
      const initial = role === 'admin' ? { id: 'qa-admin', email: 'qa@example.invalid' } : { id: 'qa-user', username: 'qa-user' };
      const account = await database[role].create({ data: { ...initial, passwordHash, updatedAt: new Date('2000-01-01T00:00:00.000Z') } });
      const payload = role === 'admin' ? { adminId: account.id, email: account.email } : { userId: account.id, username: account.username };
      const create = role === 'admin' ? exported.createSession : exported.createUserSession;
      const read = role === 'admin' ? exported.readSessionFromToken : exported.readUserSessionFromToken;
      const get = role === 'admin' ? exported.getSession : exported.getUserSession;
      const cookie = role === 'admin' ? exported.sessionCookieName : exported.userSessionCookieName;
      const issuedAt = Math.floor(Date.now() / 1000) - 60;
      const legacy = await new jose.SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 7 * 86400).sign(new TextEncoder().encode(secret));
      jar.set(cookie, legacy);
      assert.ok(await get());
      await database[role].update({ where: { id: account.id }, data: { updatedAt: new Date(issuedAt * 1000) } });
      assert.equal(await read(legacy), null, 'the exact legacy credential boundary is ambiguous');
      await create(payload, passwordHash);
      const oldBound = jar.get(cookie);
      assert.ok(await get());
      const changedHash = await bcrypt.hash('different-session-qa-password', 4);
      await database[role].update({ where: { id: account.id }, data: { passwordHash: changedHash, updatedAt: new Date(issuedAt * 1000) } });
      assert.equal(await read(oldBound), null, 'password changes invalidate even an equal SQLite timestamp');
      await assert.rejects(() => create(payload, passwordHash), /INQUIRY_CREDENTIAL_CHANGED/);
      await create(payload, changedHash);
      const bound = jar.get(cookie);
      assert.ok(await read(bound));
      await database[role].delete({ where: { id: account.id } });
      assert.equal(await read(bound), null);
      assert.equal(await get(), null);
    }
    assert.equal(await database.admin.count(), 0);
    assert.equal(await database.user.count(), 0);
  } finally {
    await database.$disconnect();
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('sabalan-inquiry-session-db-'));
    fs.rmSync(root, { recursive: true });
  }
});
