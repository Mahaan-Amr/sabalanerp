import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { createContract, updateContract, ContractProductGraphValidationError } from '../contractService';
import { buildLegacyContractMigrationPlan, readContractProductGraphWithoutWriting } from '../contractProductGraphMigration';
import { parseCanonicalProductGraph, projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';

const databaseUrl = new URL(process.env.DATABASE_URL ?? 'missing://configuration');
assert.ok((['localhost', '127.0.0.1'].includes(databaseUrl.hostname) && databaseUrl.port === '55432') ||
  (databaseUrl.hostname === 'postgres' && databaseUrl.port === '5432'), 'Use only the existing sabalanerp-local database');
const fixture = JSON.parse(readFileSync(`${__dirname}/../../../../packages/contract-product-graph/src/__tests__/fixtures/remaining-child-chain.json`, 'utf8'));
const database = new PrismaClient();
const rollback = Symbol('remaining recovery integration rollback');

const run = async () => {
  try {
    await database.$transaction(async tx => {
      const key = `qa-remaining-${randomUUID()}`;
      const department = await tx.department.create({ data: { name: key, namePersian: key } });
      const user = await tx.user.create({ data: { username: key, email: `${key}@example.invalid`, password: 'disabled-qa-account',
        firstName: 'آزمون', lastName: 'باقی‌مانده', role: 'USER', departmentId: department.id } });
      const customer = await tx.crmCustomer.create({ data: { firstName: 'آزمون', lastName: 'بازسازی' } });
      const project = await tx.projectAddress.create({ data: { customerId: customer.id, address: 'نشانی آزمون' } });
      let serialized = JSON.stringify(fixture);
      for (const [index, catalogId] of [...new Set<string>(fixture.map((p: any) => p.productId))].entries()) {
        const product = await tx.product.create({ data: { code: `${key}-${index}`, name: key, namePersian: key,
          cuttingDimensionCode: 'qa', cuttingDimensionName: 'qa', cuttingDimensionNamePersian: 'آزمون',
          stoneTypeCode: 'qa', stoneTypeName: 'qa', stoneTypeNamePersian: 'آزمون', widthCode: 'qa', widthValue: 40, widthName: 'qa',
          thicknessCode: 'qa', thicknessValue: 2, thicknessName: 'qa', mineCode: 'qa', mineName: 'qa', mineNamePersian: 'آزمون',
          finishCode: 'qa', finishName: 'qa', finishNamePersian: 'آزمون', colorCode: 'qa', colorName: 'qa', colorNamePersian: 'آزمون',
          qualityCode: 'qa', qualityName: 'qa', qualityNamePersian: 'آزمون', images: [] } });
        serialized = serialized.split(catalogId).join(product.id);
      }
      const products = JSON.parse(serialized);
      const client = new Proxy(tx, { get(target, property) {
        if (property === '$transaction') return (work: (transaction: Prisma.TransactionClient) => Promise<unknown>) => work(tx);
        return Reflect.get(target, property);
      } }) as unknown as PrismaClient;
      const contractData = { customerId: customer.id, customer, projectId: project.id, project, products, discount: null };
      const relations = { items: products.map((p: any) => ({ productId: p.productId, productRowId: p.rowId,
        productType: p.productType, quantity: p.quantity, unitPrice: p.pricePerSquareMeter ?? 0, totalPrice: p.totalPrice,
        originalTotalPrice: p.originalTotalPrice, isMandatory: p.isMandatory, mandatoryPercentage: p.mandatoryPercentage })) };
      const data = { title: key, titlePersian: key, content: 'آزمون بازسازی', customerId: customer.id, departmentId: department.id,
        totalAmount: 23071875, currency: 'تومان', contractData, _relations: relations };
      const inputBefore = JSON.stringify(data);
      const created = await createContract(data, user.id, undefined, client);
      assert.equal(JSON.stringify(data), inputBefore, 'Caller draft is retained intact');
      const state = () => tx.salesContract.findUniqueOrThrow({ where: { id: created.id },
        include: { productGraphState: true, items: { orderBy: { id: 'asc' } },
          deliveries: { orderBy: { id: 'asc' } }, payments: { orderBy: { id: 'asc' } } } });
      const saved = await state();
      const savedGraph = parseCanonicalProductGraph(saved.productGraphState!.graph);
      assert.equal(savedGraph.allocations.length, 3);
      assert.deepEqual(projectCanonicalProductGraph(savedGraph, 'accounting').products.slice(1, 4).map(p => p.baseAmountToman), ['0', '0', '0']);
      assert.equal(saved.totalAmount!.toString(), '23071875');
      assert.equal((saved.contractData as any).discount.baseSubtotal, '19656250');
      assert.equal(saved.items.length, 5);

      // Simulate an existing historical snapshot with the old missing allocation/base fields.
      const historical = buildLegacyContractMigrationPlan({ id: created.id, totalAmount: created.totalAmount, contractData: saved.contractData }, 1);
      assert.ok(historical.ok);
      if (!historical.ok) throw new Error('Historical fixture invalid');
      await tx.salesContractProductGraphState.update({ where: { contractId: created.id },
        data: { graph: JSON.parse(JSON.stringify(historical.graph)), policySnapshot: historical.graph.calculationPolicy as any } });
      const beforeRead = JSON.stringify(await state());
      await readContractProductGraphWithoutWriting(client, created.id);
      assert.equal(JSON.stringify(await state()), beforeRead, 'Reading history never repairs it');
      await updateContract(created.id, { contractData: saved.contractData, totalAmount: 23071875 }, user.id, client);
      const edited = await state();
      const editedGraph = parseCanonicalProductGraph(edited.productGraphState!.graph);
      assert.equal(editedGraph.revision, 2);
      assert.equal(editedGraph.allocations.length, 3);
      assert.equal(editedGraph.calculationPolicy.rounding, historical.graph.calculationPolicy.rounding, 'Existing contract policy retained');
      assert.equal(edited.totalAmount!.toString(), '23071875');
      assert.deepEqual(edited.items.map(i => i.id), saved.items.map(i => i.id));

      const broken = structuredClone(edited.contractData) as any;
      delete broken.products[1].cuttingBreakdown[0].rate;
      const beforeFailure = JSON.stringify(await state());
      const auditCount = await tx.salesContractProductGraphAudit.count({ where: { contractId: created.id } });
      await assert.rejects(updateContract(created.id, { contractData: broken, _relations: relations }, user.id, client), ContractProductGraphValidationError);
      assert.equal(JSON.stringify(await state()), beforeFailure, 'Failed edit changes no products, graph, amounts, payments or deliveries');
      assert.equal(await tx.salesContractProductGraphAudit.count({ where: { contractId: created.id } }), auditCount);
      const countBefore = await tx.salesContract.count();
      await assert.rejects(createContract({ ...data, contractData: broken }, user.id, undefined, client), ContractProductGraphValidationError);
      assert.equal(await tx.salesContract.count(), countBefore, 'Invalid create inserts no contract');

      await tx.salesContract.update({ where: { id: created.id }, data: { status: 'SIGNED' } });
      const signedBefore = JSON.stringify(await state());
      await assert.rejects(updateContract(created.id, { contractData: saved.contractData }, user.id, client), /approved formal correction/);
      assert.equal(JSON.stringify(await state()), signedBefore, 'Repair never bypasses signed-contract correction authorization');
      console.log('remaining recovery create/edit/database rollback integration passed');
      throw rollback;
    }, { timeout: 60000, maxWait: 10000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await database.$disconnect();
  }
};
run().catch(error => { console.error(error); process.exitCode = 1; });
