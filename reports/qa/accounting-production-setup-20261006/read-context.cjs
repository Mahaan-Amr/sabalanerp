const { PrismaClient } = require('/app/node_modules/@prisma/client');
const db = new PrismaClient();
(async () => {
  const result = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return {
      entities: await tx.accountingLegalEntity.findMany({include:{books:{include:{codeSchemes:true,fiscalYears:{include:{periods:true}}}}}}),
      accounts: await tx.accountingLedgerAccount.findMany({orderBy:{code:'asc'}}),
      rules: await tx.accountingCustomerPostingRule.findMany(),
      financialAccounts: await tx.accountingFinancialAccount.findMany(),
      settings: await tx.accountingSetting.findMany(),
      admins: await tx.user.findMany({where:{role:'ADMIN'},select:{id:true,username:true,role:true}}),
      counts: {receipts:await tx.accountingTreasuryTransaction.count(), openItems:await tx.accountingCustomerOpenItem.count(), profiles:await tx.accountingCustomerProfile.count()},
    };
  }, {isolationLevel:'RepeatableRead'});
  console.log(JSON.stringify(result));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.$disconnect());
