/** Creator reads and recovery writes authorize and audit inside their owning
 * transaction. Match ordinary contract creation's bounded allowance rather
 * than Prisma's five-second default; this is not a global pool policy. */
export const PARTNER_CREATION_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
