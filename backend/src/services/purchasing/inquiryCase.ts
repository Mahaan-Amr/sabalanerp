import { inquiryCommand } from './contractEntry';
import { assertCapability, type Access, type Actor } from './access';
import { createDocument, updateDocument, type Tx } from './repository';
import { PurchasingError, required, text, type JsonObject } from './domain';

/** One visible RFQ case, independently actionable stable lines. The owning
 * command transaction makes creation/replay atomic without blocking ready lines. */
export async function startInquiryCase(tx: Tx, actor: Actor, access: Access, input: JsonObject) {
  assertCapability(access.requester);
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
    throw new PurchasingError('INQUIRY_LINES_REQUIRED', 'یک یا چند قلم موردنیاز را انتخاب کنید.', 400, 'lines');
  }
  const reason = input.reason === 'stock' ? 'stock' : input.reason === 'prospect' ? 'prospect' : input.reason==='market'?'market':'contract';
  const contractId = reason === 'contract' ? required(input.contractId, 'contractId', 'قرارداد') : null;
  const ownerId = required(input.ownerId, 'ownerId', 'مسئول پیگیری خرید');
  const group = await createDocument(tx, actor.id, 'INQUIRY_CASE', {
    reason, title: text(input.title) || (reason === 'contract' ? 'تأمین اقلام قرارداد' : reason === 'stock' ? 'تأمین نیاز انبار' : reason==='market'?'استعلام مستقل قیمت':'استعلام پیش از قرارداد'),
    lineIds: [], notes: text(input.notes),
  }, { ownerId, contractId });
  const lineIds: string[] = [], seen = new Set<string>();
  let contractNumber: string | null = null, customerId: string | null = null;
  for (const line of input.lines) {
    const rowId = text(line.rowId);
    if (reason === 'contract' && seen.has(rowId)) throw new PurchasingError('DUPLICATE_ROW', 'هر ردیف قرارداد را فقط یک بار انتخاب کنید.');
    if (reason === 'contract') seen.add(rowId);
    const child = await inquiryCommand(tx, actor, access, 'INQUIRY_CREATE', {
      ...line, reason, contractId, ownerId, groupId: group.id,
    });
    lineIds.push(child.id);
    contractNumber = child.data.contractNumber || contractNumber;
    customerId = child.customerId || customerId;
  }
  return updateDocument(tx, actor.id, group, 'INQUIRY_LINES_CREATED', { ...group.data, contractNumber, lineIds }, group.version, {customerId});
}
