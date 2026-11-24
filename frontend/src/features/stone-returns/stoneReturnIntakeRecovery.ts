import type { StoneReturnIntakeCommand } from './stoneReturnApi';

export function createStoneReturnIntakeClient<Result>(
  actorId: string,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  record: (command: StoneReturnIntakeCommand, actorId: string) => Promise<Result>,
) {
  const key = `logistics:stone-return:pending:v1:${actorId}`;
  const hasPending = () => storage.getItem(key) !== null;
  async function send(command: StoneReturnIntakeCommand) {
    let result: Result;
    try {
      result = await record(command, actorId);
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      // These domain responses are issued before a receipt can be committed.
      if (status === 400 || status === 404 || status === 409) storage.removeItem(key);
      throw error;
    }
    try { storage.removeItem(key); } catch { /* A later replay returns this receipt. */ }
    return result;
  }
  return {
    hasPending,
    async submit(input: Omit<StoneReturnIntakeCommand, 'requestId'>) {
      if (hasPending()) throw new Error('ابتدا نتیجه دریافت قبلی را پیگیری کنید.');
      const command = { ...input, requestId: crypto.randomUUID() };
      storage.setItem(key, JSON.stringify(command));
      return send(command);
    },
    async resume() {
      const saved = storage.getItem(key);
      if (!saved) throw new Error('درخواست ثبت‌شده‌ای برای پیگیری پیدا نشد.');
      return send(JSON.parse(saved) as StoneReturnIntakeCommand);
    },
  };
}
