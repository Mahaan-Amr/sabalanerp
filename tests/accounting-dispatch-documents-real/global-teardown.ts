import { removeQaIdentities, withQaDatabase } from './qa-identities';

export default async function globalTeardown() {
  await withQaDatabase(async (client) => {
    await client.query('BEGIN');
    try {
      await removeQaIdentities(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
