import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createTemporaryConcurrencyDatabase } from '../../services/__tests__/shipmentStatementConcurrency/database';

const sourceDatabaseUrl = process.env.PROJECT_RETURN_TEST_DATABASE_URL;
const receipts = '/api/logistics/project-returns';
const guard = '/api/security/canonical-driver-queue';

test('Logistics records and reopens exact multi-project receipt quantities and healthy-only stock', {
  skip: !sourceDatabaseUrl, timeout: 240_000,
}, async () => {
  const isolated = await createTemporaryConcurrencyDatabase({
    repositoryRoot: path.resolve(__dirname, '../../../..'), sourceDatabaseUrl: sourceDatabaseUrl!, migrateEmptySchema: true,
  });
  const db = isolated.client();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = isolated.databaseUrl;
  let server: Server | undefined;
  let disconnectRuntime: (() => Promise<void>) | undefined;
  try {
    disconnectRuntime = (await import('../../lib/prisma')).disconnectDatabase;
    const { createAuthoritativeSession, SESSION_COOKIE } = await import('../../services/identitySessionService');
    const { default: guardRouter } = await import('../canonical-guard-queue');
    const { default: logisticsRouter } = await import('../logistics');
    const { default: productsRouter } = await import('../products');
    const { default: accountingProjectReturns } = await import('../accountingProjectReturns');
    const { default: inventoryRouter } = await import('../accountingSupplyChain');
    const { hashSupplyChainEvidence } = await import('../../services/accountingSupplyChain');
    const { shipmentQuantityEvidenceIntegrityHash } = await import('../../services/shipmentQuantityProjectionStore');
    const actor = await db.user.create({ data: {
      email: 'project-return-506@example.invalid', username: 'project-return-506',
      firstName: 'آزمون', lastName: 'مرجوعی', password: 'non-login-fixture', role: 'ADMIN', mustChangePassword: false,
    } });
    await db.workspacePermission.create({
      data: { userId: actor.id, workspace: 'accounting', permissionLevel: 'edit' },
    });
    const customer = await db.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'آزمون مرجوعی' } });
    const project = await db.projectAddress.create({ data: { customerId: customer.id, projectName: 'پروژه سپید', address: 'نشانی آزمون' } });
    const otherCustomer = await db.crmCustomer.create({ data: { firstName: 'خارج', lastName: 'از محدوده' } });
    const otherProject = await db.projectAddress.create({
      data: { customerId: otherCustomer.id, projectName: 'پروژه دیگر', address: 'نشانی دیگر' },
    });
    const emptyProject = await db.projectAddress.create({
      data: { customerId: customer.id, projectName: 'پروژه بدون قرارداد', address: 'نشانی بدون قرارداد' },
    });
    const department = await db.department.create({ data: { name: 'Sales Returns QA', namePersian: 'فروش آزمون' } });
    const product = await db.product.create({ data: {
      code: 'RETURN-506', name: 'Stone 506', namePersian: 'سنگ گرانیت سپید',
      cuttingDimensionCode: '1', cuttingDimensionName: 'slab', cuttingDimensionNamePersian: 'اسلب',
      stoneTypeCode: '1', stoneTypeName: 'granite', stoneTypeNamePersian: 'گرانیت',
      widthCode: '1', widthValue: 60, widthName: '۶۰', thicknessCode: '1', thicknessValue: 2, thicknessName: '۲',
      mineCode: '1', mineName: 'mine', mineNamePersian: 'معدن', finishCode: '1', finishName: 'polished', finishNamePersian: 'سابیده',
      colorCode: '1', colorName: 'white', colorNamePersian: 'سفید', qualityCode: '1', qualityName: 'first', qualityNamePersian: 'درجه یک',
      images: [], isAvailable: false,
    } });
    await db.salesContract.create({ data: {
      customerId: customer.id, departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id,
      contractNumber: 'SECRET-RETURN-506', title: 'Contract QA', titlePersian: 'عنوان قرارداد', content: 'fixture', status: 'APPROVED',
      contractData: { projectId: project.id, products: [{ rowId: 'stone-row', productId: product.id, unit: 'squareMeter' }] },
      items: { create: { productId: product.id, productRowId: 'stone-row', quantity: 1, unitPrice: 1, totalPrice: 1 } },
    } });
    await db.salesContract.create({ data: {
      customerId: otherCustomer.id, departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id,
      contractNumber: 'WRONG-CUSTOMER-RETURN', title: 'Contract QA', titlePersian: 'قرارداد مشتری دوم', content: 'fixture',
      contractData: { projectId: otherProject.id, products: [{ rowId: 'correct-customer-row', productId: product.id, unit: 'squareMeter' }] },
      items: { create: { productId: product.id, productRowId: 'correct-customer-row', quantity: 5, unitPrice: 1, totalPrice: 5 } },
    } });
    const extraProject = await db.projectAddress.create({
      data: { customerId: customer.id, projectName: 'پروژه دوم', address: 'نشانی آزمون دوم' },
    });
    const { id: _originalProductId, createdAt: _created, updatedAt: _updated, ...productFields } = product;
    const lengthProduct = await db.product.create({
      data: { ...productFields, code: 'LINEAR-507', name: 'Length stone', namePersian: 'سنگ طولی' },
    });
    await db.salesContract.create({ data: {
      customerId: customer.id, departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id,
      contractNumber: 'SECRET-RETURN-507', title: 'Contract QA', titlePersian: 'عنوان قرارداد دوم', content: 'fixture', status: 'APPROVED',
      contractData: { projectId: extraProject.id, products: [
        { rowId: 'shared', productId: product.id, unit: 'squareMeter' },
        { rowId: 'piece', productId: product.id, unit: 'count' },
        { rowId: 'length', productId: lengthProduct.id, unit: 'meter', width: '40', widthUnit: 'cm' },
        { rowId: 'length-2', productId: lengthProduct.id, unit: 'meter', width: '0.4', widthUnit: 'm' },
      ] },
      items: { create: [
        { productId: product.id, productRowId: 'shared', quantity: 1, unitPrice: 1, totalPrice: 1 },
        { productId: product.id, productRowId: 'piece', quantity: 1, unitPrice: 1, totalPrice: 1 },
        { productId: lengthProduct.id, productRowId: 'length', quantity: 9, unitPrice: 100, totalPrice: 900 },
        { productId: lengthProduct.id, productRowId: 'length-2', quantity: 9, unitPrice: 100, totalPrice: 900 },
      ] },
    } });
    const session = await createAuthoritativeSession(db, actor.id, { ipAddress: '127.0.0.1', userAgent: 'project-return-receipt-qa' });
    const app = express();
    app.use(express.json());
    app.use('/api/security', guardRouter);
    app.use('/api/logistics', logisticsRouter);
    app.use('/api/products', productsRouter);
    app.use('/api/accounting/supply-chain', inventoryRouter);
    app.use('/api/accounting/project-returns', accountingProjectReturns);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => server!.once('listening', resolve).once('error', reject));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(origin + route, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${session.token}` },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      assert.match(response.headers.get('content-type') || '', /application\/json/, `${route}: HTTP ${response.status}`);
      const envelope = await response.json() as {
        success: boolean;
        data: any;
        error?: string;
        code?: string;
        replayed?: boolean;
      };
      return { status: response.status, ...envelope };
    };

    const admitted = await call(guard, { source: 'PERSONAL_PICKUP', plate: '43 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    assert.equal(admitted.status, 201, JSON.stringify(admitted));
    const command = {
      visitId: admitted.data.id, customerId: customer.id, projectIds: [project.id],
      items: [{ productId: product.id, unit: 'squareMeter', healthyQuantity: '35.000', damagedQuantity: '5' }],
    };
    const projectOptions = await call(`${receipts}/customers/${customer.id}/projects`);
    assert.ok(projectOptions.data.some((option: { id: string }) => option.id === project.id));
    assert.ok(projectOptions.data.every((option: { id: string }) => option.id !== otherProject.id));
    const products = (projectId: string, search = '') =>
      call(`${receipts}/products?customerId=${customer.id}&projectId=${projectId}&search=${encodeURIComponent(search)}`);
    const productOptions = await products(project.id, 'سپید');
    assert.deepEqual(productOptions.data, [{
      productId: product.id, productName: 'سنگ گرانیت سپید', productCode: 'RETURN-506', unit: 'squareMeter',
    }], 'Only product facts are available to Logistics');
    assert.deepEqual((await products(emptyProject.id)).data, []);
    assert.equal((await products(otherProject.id)).status, 400);
    assert.equal((await call(receipts, { ...command, visitId: 'missing' })).status, 400);
    const loadingVisit = await call(guard, { source: 'CUSTOMER_PICKUP', vehicleType: 'وانت', phone: '09120000506', plate: '44 ب 345 ایران 67' });
    assert.equal(loadingVisit.status, 201);
    assert.equal((await call(receipts, { ...command, visitId: loadingVisit.data.id })).status, 400);
    assert.equal((await call(receipts, { ...command, projectIds: [otherProject.id] })).status, 400);
    assert.equal((await call(receipts, { ...command, projectIds: [emptyProject.id] })).status, 400);
    assert.equal((await call(receipts, { ...command, items: [{ ...command.items[0], unit: 'meter' }] })).status, 400);
    assert.equal((await call(receipts, { ...command, items: [{ ...command.items[0], healthyQuantity: '-1' }] })).status, 400);
    assert.deepEqual((await call(receipts)).data.items, []);
    const queued = await call('/api/logistics/project-return-visits');
    assert.equal(queued.data.find((visit: { id: string }) => visit.id === admitted.data.id).projectReturnStatus, 'AWAITING_RECEIPT');

    const duplicates = await Promise.all([call(receipts, command), call(receipts, command)]);
    assert.deepEqual(duplicates.map(item => item.status).sort(), [200, 201]);
    assert.equal(duplicates[0].data.id, duplicates[1].data.id);
    const reopened = await call(`${receipts}/${duplicates[0].data.id}`);
    assert.equal(reopened.status, 200);
    assert.equal(reopened.data.version.projects[0].projectId, project.id);
    assert.equal(reopened.data.version.items[0].unit, 'squareMeter');
    assert.equal(reopened.data.version.items[0].healthyQuantity, '35');
    assert.equal(reopened.data.version.items[0].damagedQuantity, '5');
    assert.equal(reopened.data.version.items[0].healthyAreaSquareMeters, '35');
    assert.equal(reopened.data.version.items[0].damagedAreaSquareMeters, '5');
    assert.equal(reopened.data.version.items[0].effectiveWidthMeters, null);
    assert.equal(reopened.data.visit.projectReturnStatus, 'RECEIVED');
    const personalVisit = `${guard}/${admitted.data.id}`;
    assert.equal((await call(`${personalVisit}/project-return-transfer`, {})).status, 409);
    const completed = await call(`${personalVisit}/project-return-complete`, {});
    assert.equal(completed.status, 200, JSON.stringify(completed));
    assert.equal(completed.data.status, 'WAITING_AT_GATE');
    assert.equal(completed.data.loadingId, null);
    assert.equal(completed.data.exitedAt, null);
    assert.equal((await call(`${personalVisit}/project-return-complete`, {})).status, 200);
    assert.ok(!(await call('/api/logistics/drivers')).data.some((row: { id: string }) => row.id === admitted.data.id));
    const departed = await call(`${personalVisit}/project-return-exit`, {});
    assert.equal(departed.status, 200);
    assert.equal(departed.data.status, 'EXIT_RECORDED');
    const history = await call(`${guard}?history=true`);
    assert.equal(history.status, 200);
    assert.ok(history.data.some((row: { id: string }) => row.id === admitted.data.id));
    const personalHistory = await call(`${personalVisit}/events`);
    assert.equal(personalHistory.status, 200);
    assert.deepEqual(personalHistory.data.map((event: { eventType: string }) => event.eventType).sort(), [
      'ADMITTED', 'PHYSICAL_EXIT_RECORDED', 'PROJECT_RETURN_PERSONAL_COMPLETED', 'PROJECT_RETURN_RECEIVED',
    ]);
    const changed = { ...command, items: [{ ...command.items[0], healthyQuantity: '34' }] };
    assert.equal((await call(receipts, changed)).status, 409);
    const normalized = { ...command, items: [{ ...command.items[0], healthyQuantity: '35' }] };
    const replay = await call(receipts, normalized);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.version.id, reopened.data.version.id);
    assert.equal((await call('/api/logistics/stone-returns')).status, 200);
    assert.deepEqual((await call('/api/logistics/stone-returns')).data.items, []);
    assert.equal((await call(receipts)).data.items.length, 1);

    const multiVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '48 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    const multiProductUrl = `${receipts}/products?customerId=${customer.id}&projectId=${project.id}&projectId=${extraProject.id}`;
    const multiProducts = await call(multiProductUrl);
    assert.equal(multiProducts.status, 200, JSON.stringify(multiProducts));
    assert.deepEqual(multiProducts.data.map(({ productId, unit }: { productId: string; unit: string }) => `${productId}:${unit}`).sort(),
      [`${product.id}:squareMeter`, `${product.id}:count`, `${lengthProduct.id}:meter`].sort());
    assert.deepEqual((await call(`${multiProductUrl}&search=LINEAR-507`)).data.map((item: { productId: string }) => item.productId), [lengthProduct.id]);
    assert.equal((await call(`${multiProductUrl}&projectId=${otherProject.id}`)).status, 400);
    const linear = {
      productId: lengthProduct.id, unit: 'meter', healthyQuantity: '0',
      damagedCalculation: { khatRas: '0.300000000000000000000000000001', pieceCount: '3', plus: '0.1', minus: '0.2' },
    };
    const multiCommand = { ...command, visitId: multiVisit.data.id, projectIds: [project.id, extraProject.id],
      items: [command.items[0], linear] };
    assert.equal((await call(receipts, { ...multiCommand, items: [...multiCommand.items, command.items[0]] })).status, 400);
    assert.equal((await call(receipts, { ...multiCommand, items: [{ ...linear, unit: 'squareMeter' }] })).status, 400);
    assert.equal((await call(receipts, { ...multiCommand, items: [{ ...linear,
      damagedCalculation: { ...linear.damagedCalculation, pieceCount: '1.5' },
    }] })).status, 400);
    assert.equal((await call(receipts, { ...multiCommand, items: [{ ...linear,
      damagedCalculation: { ...linear.damagedCalculation, minus: '9' },
    }] })).status, 400);
    assert.equal((await call(receipts, { ...multiCommand, items: [{
      productId: product.id, unit: 'count', healthyQuantity: '1.5', damagedQuantity: '0',
    }] })).status, 400);
    const multiRecorded = await call(receipts, multiCommand);
    assert.equal(multiRecorded.status, 201, JSON.stringify(multiRecorded));
    const multiReopened = await call(`${receipts}/${multiRecorded.data.id}`);
    assert.deepEqual(multiReopened.data.version.projects.map((line: { projectId: string }) => line.projectId).sort(),
      [project.id, extraProject.id].sort());
    const directItem = multiReopened.data.version.items.find((line: { productId: string }) => line.productId === product.id);
    const linearItem = multiReopened.data.version.items.find((line: { productId: string }) => line.productId === lengthProduct.id);
    assert.equal(directItem.healthyQuantity, '35');
    assert.equal(directItem.damagedQuantity, '5');
    assert.equal(linearItem.healthyQuantity, '0');
    assert.equal(linearItem.damagedQuantity, '0.800000000000000000000000000003');
    assert.equal(linearItem.effectiveWidthMeters, '0.4');
    assert.equal(linearItem.healthyAreaSquareMeters, '0');
    assert.equal(linearItem.damagedAreaSquareMeters, '0.320000000000000000000000000001');
    assert.deepEqual(linearItem.damagedCalculation, linear.damagedCalculation);
    assert.equal(linearItem.inventoryIdentityId, null);
    assert.ok(directItem.inventoryIdentityId);
    const catalog = (search: string, available: boolean) => call(`/api/products?search=${search}&isAvailable=${available}`);
    const healthyStock = await catalog(product.code, true);
    assert.equal(healthyStock.status, 200, JSON.stringify(healthyStock));
    assert.deepEqual(healthyStock.data.map((entry: { id: string; availableReturnStock: unknown }) => ({
      id: entry.id, stock: entry.availableReturnStock,
    })), [{ id: product.id, stock: [{ unit: 'squareMeter', quantity: '70' }] }]);
    assert.deepEqual((await catalog(lengthProduct.code, true)).data, []);
    assert.deepEqual((await catalog(lengthProduct.code, false)).data[0].availableReturnStock, []);
    const approvals = ['project-reserve-507-a', 'project-reserve-507-b'];
    await db.accountingOperationalEvidenceReceipt.createMany({ data: approvals.map(sourceId => {
      const sourcePayload = { purposeId: sourceId, identityId: directItem.inventoryIdentityId, quantity: '25', unit: 'squareMeter' };
      return {
        ownerWorkspace: 'inventory', sourceType: 'INVENTORY_RESERVATION_APPROVAL', sourceId, sourceVersion: 1,
        sourcePayload, sourceHash: hashSupplyChainEvidence(sourcePayload), occurredAt: new Date(),
      };
    }) });
    const reservations = await Promise.all(approvals.map(key => call('/api/accounting/supply-chain/inventory/reservations', {
      identityId: directItem.inventoryIdentityId, quantity: '25', unit: 'squareMeter', purposeId: key, idempotencyKey: key,
      evidence: { type: 'INVENTORY_RESERVATION_APPROVAL', id: key, version: 1 },
    })));
    assert.deepEqual(reservations.map(result => result.status).sort(), [201, 409], JSON.stringify(reservations));
    assert.equal(reservations.find(result => result.status === 409)?.code, 'INSUFFICIENT_INVENTORY');
    assert.deepEqual((await catalog(product.code, true)).data[0].availableReturnStock, [{ unit: 'squareMeter', quantity: '45' }]);
    assert.equal((await call(receipts, { ...multiCommand, projectIds: [...multiCommand.projectIds].reverse(),
      items: [...multiCommand.items].reverse(),
    })).status, 200);

    const edited = await call(`${receipts}/${reopened.data.id}/edit`, {
      expectedVersionId: reopened.data.version.id, projectIds: [project.id],
      items: [{ ...command.items[0], healthyQuantity: '27', damagedQuantity: '3' }],
    });
    assert.equal(edited.status, 200, JSON.stringify(edited));
    assert.equal(edited.data.version.baseVersionId, reopened.data.version.id);
    assert.equal(edited.data.version.items[0].healthyQuantity, '27');
    const originalVersion = await call(`${receipts}/${reopened.data.id}/versions/${reopened.data.version.id}`);
    assert.equal(originalVersion.data.version.items[0].healthyQuantity, '35');
    assert.equal((await call(receipts, command)).data.version.id, reopened.data.version.id);
    assert.equal((await catalog(product.code, true)).data[0].availableReturnStock[0].quantity, '37');

    const rejectedCustomerChange = await call(`${receipts}/${reopened.data.id}/edit`, {
      ...command, expectedVersionId: edited.data.version.id, customerId: otherCustomer.id,
    });
    assert.equal(rejectedCustomerChange.status, 400, JSON.stringify(rejectedCustomerChange));
    const correctedCustomer = await call(`${receipts}/${reopened.data.id}/edit`, {
      expectedVersionId: edited.data.version.id, customerId: otherCustomer.id, projectIds: [otherProject.id],
      items: [{ ...command.items[0], healthyQuantity: '27', damagedQuantity: '3' }],
    });
    assert.equal(correctedCustomer.status, 200, JSON.stringify(correctedCustomer));
    assert.equal(correctedCustomer.data.customerId, otherCustomer.id);
    assert.equal(correctedCustomer.data.visit.id, admitted.data.id);
    assert.equal((await call(`${receipts}/${reopened.data.id}`)).data.customerId, otherCustomer.id);
    assert.equal((await call(`/api/accounting/project-returns/${reopened.data.id}`)).data.receipt.customerId, otherCustomer.id);
    assert.equal((await call(`${receipts}/${reopened.data.id}/versions/${edited.data.version.id}`)).data.customerId, customer.id);
    assert.equal((await call(receipts, command)).data.customerId, customer.id);
    const correctedIdentity = correctedCustomer.data.version.items[0].inventoryIdentityId;
    await assert.rejects(db.projectReturnVersionItem.update({
      where: { inventoryIdentityId: correctedIdentity }, data: { healthyQuantity: '999' },
    }));
    await assert.rejects(db.projectReturnVersion.update({
      where: { id: correctedCustomer.data.version.id }, data: { customerId: customer.id },
    }));
    await assert.rejects(db.projectReturnVersionProject.update({
      where: { versionId_projectId: { versionId: correctedCustomer.data.version.id, projectId: otherProject.id } },
      data: { projectName: 'بازنویسی' },
    }));
    await assert.rejects(db.projectReturnOperation.delete({ where: { id: correctedCustomer.data.operations[0].id } }));
    assert.equal((await catalog(product.code, true)).data[0].availableReturnStock[0].quantity, '37');


    const reservedCasePath = `${receipts}/${multiRecorded.data.id}`;
    const reservedVersion = { expectedVersionId: multiRecorded.data.version.id };
    assert.equal((await call(`${reservedCasePath}/edit`, { ...reservedVersion, projectIds: [project.id], items: command.items })).status, 409);
    const blockedCancel = await call(`${reservedCasePath}/cancel`, reservedVersion);
    assert.equal(blockedCancel.status, 409);
    assert.match(blockedCancel.error ?? '', /رزرو فعال/);
    const requested = await call(`${reservedCasePath}/request-rework`, reservedVersion);
    assert.equal(requested.status, 200, JSON.stringify(requested));
    assert.equal(requested.data.operationStatus, 'REWORK_REQUESTED');
    assert.equal((await call(`${reservedCasePath}/cancel`, reservedVersion)).status, 409);

    async function inventoryEvidence(sourceType: string, sourceId: string, sourcePayload: object) {
      await db.accountingOperationalEvidenceReceipt.create({ data: {
        ownerWorkspace: 'inventory', sourceType, sourceId, sourceVersion: 1,
        sourcePayload, sourceHash: hashSupplyChainEvidence(sourcePayload), occurredAt: new Date(),
      } });
      return { type: sourceType, id: sourceId, version: 1 };
    }
    async function reservationBody(key: string, identityId: string) {
      const input = { purposeId: key, identityId, quantity: '1', unit: 'squareMeter' };
      const evidence = await inventoryEvidence('INVENTORY_RESERVATION_APPROVAL', key, input);
      return { ...input, evidence, idempotencyKey: key };
    }
    const reservePath = '/api/accounting/supply-chain/inventory/reservations';
    const reserve = async (key: string, identityId: string) => call(reservePath, await reservationBody(key, identityId));
    const unprovenIdentity = 'project-return-item:fixture-missing-witness';
    await db.accountingInventoryIdentity.create({ data: {
      id: unprovenIdentity, kind: 'FINISHED_GOOD', originId: 'fixture-missing-witness',
      valuationMethod: 'SPECIFIC_IDENTIFICATION', governedUnit: 'meter',
    } });
    await db.projectReturnCase.create({ data: {
      customerId: customer.id, customerName: 'مشتری آزمون مرجوعی', guardVisitId: loadingVisit.data.id, intakeHash: 'unproven-fixture',
      versions: { create: {
        number: 1, customerId: customer.id, customerName: 'مشتری آزمون مرجوعی', submittedAt: new Date(), submittedBy: actor.id,
        items: { create: {
          id: 'fixture-missing-witness', productId: lengthProduct.id, productCode: lengthProduct.code, productName: lengthProduct.name,
          unit: 'meter', healthyQuantity: '8', damagedQuantity: '0', inventoryIdentityId: unprovenIdentity,
        } },
      } },
    } });
    await db.accountingInventoryEvent.create({ data: {
      identityId: unprovenIdentity, eventType: 'RECEIPT', statusAfter: 'AVAILABLE', warehouseId: 'qa', locationId: 'qa',
      unit: 'meter', quantity: '8', occurredAt: new Date(), sourceType: 'LOGISTICS_PROJECT_RETURN_ACCEPTANCE',
      sourceId: 'fixture-missing-witness', sourceVersion: 1, sourceHash: hashSupplyChainEvidence({}), sourcePayload: {},
    } });
    assert.deepEqual((await catalog(lengthProduct.code, true)).data, []);
    assert.deepEqual((await catalog(lengthProduct.code, false)).data[0].availableReturnStock, []);

    assert.equal((await reserve('paused-510', directItem.inventoryIdentityId)).status, 409);
    const returned = await call(`/api/accounting/project-returns/${multiRecorded.data.id}/return-to-logistics`, reservedVersion);
    assert.equal(returned.status, 200, JSON.stringify(returned));
    assert.equal(returned.data.receipt.operationStatus, 'RETURNED_TO_LOGISTICS');
    assert.equal((await reserve('returned-510', directItem.inventoryIdentityId)).status, 409);
    const reservationId = reservations.find(result => result.status === 201)?.data.id;
    const released = await db.accountingInventoryReservation.findUniqueOrThrow({ where: { id: reservationId } });
    assert.equal(released.status, 'RELEASED');
    assert.equal(released.releasedBy, actor.id);
    assert.equal(released.releaseEvidenceType, 'INVENTORY_RESERVATION_RELEASE');
    assert.equal(released.releaseEvidenceHash, hashSupplyChainEvidence(released.releaseEvidencePayload));
    const cancelledReceipt = await call(`${reservedCasePath}/cancel`, reservedVersion);
    assert.equal(cancelledReceipt.status, 200, JSON.stringify(cancelledReceipt));
    assert.equal(cancelledReceipt.data.operationStatus, 'CANCELLED');
    assert.equal(cancelledReceipt.data.visit.projectReturnStatus, 'RECEIVED');
    assert.equal((await call(reservedCasePath)).data.version.items.length, 2);
    assert.equal((await catalog(product.code, true)).data[0].availableReturnStock[0].quantity, '27');

    const editedPath = `${receipts}/${edited.data.id}`;
    const editedVersion = { expectedVersionId: correctedCustomer.data.version.id };
    // Represent a lot with already-recorded operational movement evidence. The current generic
    // movement command requires valued stock, while these project receipts create no valuation.
    const movement = {
      identityId: correctedIdentity, quantity: '1', unit: 'squareMeter',
      sourceWarehouseId: 'sabalan-warehouse', sourceLocationId: 'انبار سبلان',
      warehouseId: 'sabalan-warehouse', locationId: 'قفسه آزمون',
    };
    const movementEvidence = await inventoryEvidence('INVENTORY_CUSTODY_MOVEMENT', 'movement-510', movement);
    await db.accountingInventoryEvent.create({ data: {
      ...movement, occurredAt: new Date(), eventType: 'MOVEMENT', statusAfter: 'AVAILABLE',
      sourceType: movementEvidence.type, sourceId: movementEvidence.id, sourceVersion: movementEvidence.version,
      sourcePayload: movement, sourceHash: hashSupplyChainEvidence(movement),
    } });
    const unsafeCancel = await call(`${editedPath}/cancel`, editedVersion);
    assert.equal(unsafeCancel.status, 409);
    assert.match(unsafeCancel.error ?? '', /گردش دیگری/);
    assert.equal((await call(editedPath)).data.operationStatus, 'ACTIVE');

    const raceVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '49 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    const raceCase = await call(receipts, { ...command, visitId: raceVisit.data.id });
    const racePath = `${receipts}/${raceCase.data.id}`;
    const raceIdentity = raceCase.data.version.items[0].inventoryIdentityId;
    const competingReservation = await reservationBody('competing-510', raceIdentity);
    const [raceEdit, raceReserve] = await Promise.all([
      call(`${racePath}/edit`, { expectedVersionId: raceCase.data.version.id, projectIds: [project.id], items: command.items }),
      call(reservePath, competingReservation),
    ]);
    assert.ok((raceEdit.status === 200 && raceReserve.status === 409) ||
      (raceEdit.status === 409 && raceReserve.status === 201), JSON.stringify({ raceEdit, raceReserve }));
    assert.equal((await call(racePath)).data.version.number, raceEdit.status === 200 ? 2 : 1);
    assert.equal(await db.accountingInventoryReservation.count({ where: { identityId: raceIdentity, status: 'ACTIVE' } }),
      raceReserve.status === 201 ? 1 : 0);

    const secondVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '45 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    assert.equal(secondVisit.status, 201);
    const [recorded, cancelled] = await Promise.all([
      call(receipts, { ...command, visitId: secondVisit.data.id }),
      call(`/api/logistics/project-return-visits/${secondVisit.data.id}/cancel`, {}),
    ]);
    assert.ok((recorded.status === 201 && cancelled.status === 409) ||
      (recorded.status === 409 && cancelled.status === 200), JSON.stringify({ recorded, cancelled }));
    const matching = (await call(receipts)).data.items.filter((item: typeof reopened.data) => item.visit.id === secondVisit.data.id);
    assert.equal(matching.length, recorded.status === 201 ? 1 : 0);

    const { id: _lengthId, createdAt: _lengthCreated, updatedAt: _lengthUpdated, ...lengthFields } = lengthProduct;
    const manualWidthProduct = await db.product.create({
      data: { ...lengthFields, widthValue: 0, code: 'LINEAR-514-MANUAL', namePersian: 'سنگ با عرض دستی' },
    });
    await db.salesContract.create({ data: {
      customerId: customer.id, departmentId: department.id, createdBy: actor.id, responsibleSellerId: actor.id,
      contractNumber: 'RETURN-514-MANUAL', title: 'Return width fixture', titlePersian: 'آزمون عرض سنگ', content: 'fixture', status: 'APPROVED',
      contractData: { projectId: extraProject.id, products: [{ rowId: 'manual-width', productId: manualWidthProduct.id, unit: 'meter' }] },
      items: { create: { productId: manualWidthProduct.id, productRowId: 'manual-width', quantity: 40, unitPrice: 1, totalPrice: 40 } },
    } });
    assert.equal((await products(extraProject.id, lengthProduct.code)).data[0].suggestedWidthMeters, '0.4');
    assert.equal((await products(extraProject.id, manualWidthProduct.code)).data[0].suggestedWidthMeters, null);
    const areaVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '58 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    assert.equal(areaVisit.status, 201);
    const areaItems = [lengthProduct, manualWidthProduct].map(({ id }) => ({
      productId: id, unit: 'meter', healthyQuantity: '13.5',
      damagedCalculation: { khatRas: '1.2', pieceCount: '3', plus: '0.3', minus: '0.1' },
    }));
    const areaCommand = { ...command, visitId: areaVisit.data.id, projectIds: [extraProject.id], items: areaItems };

    assert.equal((await call(receipts, { ...areaCommand, items: [{ ...areaItems[0], effectiveWidthMeters: '0.9' }] })).status, 400);
    assert.equal((await call(receipts, { ...areaCommand, items: [{ ...areaItems[1], effectiveWidthMeters: '0' }] })).status, 400);
    const unmeasuredVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '59 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    const unmeasured = await call(receipts, { ...areaCommand, visitId: unmeasuredVisit.data.id, items: [areaItems[1]] });
    assert.equal(unmeasured.status, 201, JSON.stringify(unmeasured));
    assert.equal(unmeasured.data.version.items[0].effectiveWidthMeters, null);
    assert.equal(unmeasured.data.version.items[0].healthyAreaSquareMeters, null);
    assert.equal(unmeasured.data.version.items[0].damagedAreaSquareMeters, null);
    const measured = await call(receipts, { ...areaCommand, items: [areaItems[0], { ...areaItems[1], effectiveWidthMeters: '0.25' }] });
    assert.equal(measured.status, 201, JSON.stringify(measured));
    const readArea = async () => {
      const logistics = await call(`${receipts}/${measured.data.id}`);
      const accounting = await call(`/api/accounting/project-returns/${measured.data.id}`);
      assert.equal(logistics.status, 200);
      assert.equal(accounting.status, 200, JSON.stringify(accounting));
      for (const [productId, effectiveWidthMeters, healthyAreaSquareMeters, damagedAreaSquareMeters] of [
        [lengthProduct.id, '0.4', '5.4', '1.52'],
        [manualWidthProduct.id, '0.25', '3.375', '0.95'],
      ]) {
        const matchesProduct = (item: { productId: string }) => item.productId === productId;
        for (const items of [logistics.data.version.items, accounting.data.items]) {
          const row = items.find(matchesProduct);
          assert.equal(row.healthyQuantity, '13.5');
          assert.equal(row.damagedQuantity, '3.8');
          assert.equal(row.effectiveWidthMeters, effectiveWidthMeters);
          assert.equal(row.healthyAreaSquareMeters, healthyAreaSquareMeters);
          assert.equal(row.damagedAreaSquareMeters, damagedAreaSquareMeters);
        }
      }
    };
    await readArea();
    await db.product.update({ where: { id: manualWidthProduct.id }, data: { widthValue: 50 } });
    await readArea();

    for (const [plate, disposition] of [
      ['46 ب 345 ایران 67', 'transfer'],
      ['47 ب 345 ایران 67', 'exit'],
    ]) {
      const visit = await call(guard, {
        source: 'CUSTOMER_PICKUP', vehicleType: 'وانت', phone: '09120000508', plate, purpose: 'PROJECT_RETURN',
      });
      assert.equal(visit.status, 201, JSON.stringify(visit));
      assert.equal((await call(receipts, { ...command, visitId: visit.data.id })).status, 201);
      const transitioned = await call(`${guard}/${visit.data.id}/project-return-${disposition}`, {});
      assert.equal(transitioned.status, 200, JSON.stringify(transitioned));
      assert.equal(transitioned.data.id, visit.data.id);
      assert.equal(transitioned.data.projectReturnStatus, 'RECEIVED');
      assert.equal(transitioned.data.status, disposition === 'transfer' ? 'AVAILABLE_FOR_LOADING' : 'EXIT_RECORDED');
      assert.equal(Boolean(transitioned.data.exitedAt), disposition === 'exit');
    }
    const financialContract = await db.salesContract.findUniqueOrThrow({
      where: { contractNumber: 'SECRET-RETURN-506' }, include: { items: true },
    });
    const [financialStone] = financialContract.items;
    const approvedAt = new Date();
    const financialRecord = await db.accountingFinancialRecord.create({ data: {
      kind: 'INVOICE_CANDIDATE', status: 'ISSUED', sourceKind: 'SALES_CONTRACT',
      contractId: financialContract.id, sourceId: financialContract.id, customerId: customer.id,
      systemInvoiceNumber: 'RETURN-515-ISSUED', amount: '48000000', createdBy: actor.id,
      financiallyApprovedBy: actor.id, financiallyApprovedAt: approvedAt, postedAt: approvedAt,
      sourceSnapshot: { id: financialContract.id, customerId: customer.id, contractData: financialContract.contractData! },
      invoiceItems: { create: { contractItemId: financialStone.id, productId: product.id, description: product.namePersian!,
        quantity: '8', unitPrice: '6000000', totalPrice: '48000000' } },
    }, include: { invoiceItems: true } });
    const issueFixture = {
      kind: 'INVOICE_CANDIDATE' as const, sourceKind: 'SALES_CONTRACT' as const,
      contractId: financialContract.id, sourceId: financialContract.id, customerId: customer.id,
      amount: '48000000', createdBy: actor.id, financiallyApprovedBy: actor.id, postedAt: approvedAt,
      financiallyApprovedAt: new Date(approvedAt.getTime() + 1),
      sourceSnapshot: { id: financialContract.id, customerId: customer.id, contractData: financialContract.contractData! },
      invoiceItems: { create: { contractItemId: financialStone.id, productId: product.id, description: product.namePersian!,
        quantity: '8', unitPrice: '6000000', totalPrice: '48000000' } },
    };
    await db.accountingFinancialRecord.create({ data: { ...issueFixture, status: 'DRAFT', systemInvoiceNumber: 'RETURN-515-DRAFT' } });
    await db.accountingFinancialRecord.create({ data: { ...issueFixture, status: 'VOIDED', systemInvoiceNumber: 'RETURN-515-VOID' } });
    await db.accountingFinancialRecord.create({ data: { ...issueFixture, status: 'ISSUED', systemInvoiceNumber: 'RETURN-515-WRONG-PARTY',
      customerId: otherCustomer.id } });
    await db.accountingFinancialRecord.create({ data: { ...issueFixture, status: 'ISSUED', systemInvoiceNumber: 'RETURN-515-WRONG-PROJECT',
      sourceSnapshot: { ...issueFixture.sourceSnapshot, contractData: { ...(financialContract.contractData as object), projectId: extraProject.id } } } });
    await db.accountingFinancialRecord.create({ data: { ...issueFixture, status: 'ISSUED', systemInvoiceNumber: 'RETURN-515-WRONG-UNIT',
      sourceSnapshot: { ...issueFixture.sourceSnapshot, contractData: { projectId: project.id,
        products: [{ rowId: financialStone.productRowId, productId: product.id, unit: 'count' }] } } } });
    await db.accountingFinancialRecord.create({ data: { ...issueFixture, status: 'ISSUED', systemInvoiceNumber: 'RETURN-515-WRONG-PRODUCT',
      invoiceItems: { create: { ...issueFixture.invoiceItems.create, productId: lengthProduct.id } } } });
    await db.accountingFinancialRecord.create({ data: { ...issueFixture, status: 'ISSUED', systemInvoiceNumber: 'RETURN-515-WRONG-RELATION',
      metadata: { partnerCaseId: 'unrelated-partner-case' } } });
    const financialVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '50 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    const financialCase = await call(receipts, { ...command, visitId: financialVisit.data.id,
      items: [{ ...command.items[0], healthyQuantity: '6' }] });
    assert.equal(financialCase.status, 201, JSON.stringify(financialCase));
    const financialPath = `/api/accounting/project-returns/${financialCase.data.id}`;
    const financialReview = await call(financialPath);
    assert.equal(financialReview.status, 200, JSON.stringify(financialReview));
    const [financialItem] = financialReview.data.items;
    assert.equal(financialItem.candidates.length, 1, JSON.stringify(financialItem));
    const [candidate] = financialItem.candidates;
    assert.equal(candidate.financialRecordId, financialRecord.id);
    assert.equal(candidate.financialLineId, financialRecord.invoiceItems[0].id);
    assert.equal(candidate.dispatchEvidenceId, null);
    assert.equal(candidate.remainingQuantity, '8.000');
    const profile = await db.accountingCustomerProfile.create({ data: { id: 'return-515-ordinary-profile',
      legalEntityId: 'return-515-sabalan', accountingPartyId: 'return-515-customer-party', partySourceKind: 'CUSTOMER',
      partySourceId: customer.id, displayName: 'مشتری آزمون', activeFrom: approvedAt, createdBy: actor.id } });
    const priorCommercial = await db.accountingCommercialCustomerInvoice.create({ data: {
      profileId: profile.id, contractId: financialContract.id, contractVersion: 1,
      number: 'RETURN-515-OLD-COMMERCIAL', ledgerVoucherId: 'return-515-old-voucher',
      controlPolicyId: 'return-515-policy', controlPolicyVersion: 1, controlEvidenceType: 'GUARD_EXIT',
      controlEvidenceId: 'return-515-previous-exit', controlEvidenceVersion: 1, controlEvidenceHash: 'fixture',
      netRials: '48000000', taxRials: '0', grossRials: '48000000', issuedAt: approvedAt, dueAt: approvedAt,
    } });
    const priorCredit = await db.accountingCommercialCustomerInvoice.create({ data: {
      profileId: profile.id, contractId: financialContract.id, contractVersion: 1,
      number: 'RETURN-515-OLD-CREDIT', ledgerVoucherId: 'return-515-credit-voucher',
      controlPolicyId: 'return-515-policy', controlPolicyVersion: 1, controlEvidenceType: 'EXCESS_RETURN_FINALIZED',
      controlEvidenceId: 'return-515-prior-finalization', controlEvidenceVersion: 1, controlEvidenceHash: 'fixture',
      netRials: '18000000', taxRials: '0', grossRials: '18000000', issuedAt: approvedAt, dueAt: approvedAt,
      referenceInvoiceId: priorCommercial.id, status: 'CREDIT_NOTE',
    } });
    const shipmentRow = { contractId: financialContract.id, contractItemId: financialStone.id,
      productRowId: financialStone.productRowId!, unit: 'squareMeter', effectiveAt: approvedAt, integrityHash: 'fixture' };
    const dispatch = await db.shipmentQuantityEvidence.create({ data: {
      ...shipmentRow, kind: 'PHYSICAL_EXIT', quantity: '8', sourceType: 'GUARD_PHYSICAL_EXIT', sourceId: 'return-515-prior-exit',
    } });
    await db.shipmentQuantityEvidence.create({ data: {
      ...shipmentRow, id: 'return-515-prior-finalization', kind: 'EXCESS_RETURN_FINALIZED', quantity: '3',
      sourceType: 'STONE_EXCESS_RETURN_ALLOCATION', sourceId: 'return-515-prior-allocation', dispatchEvidenceId: dispatch.id,
      metadata: { returnCaseId: 'return-515-prior-case', actorId: actor.id },
    } });
    await db.accountingReturnEvidenceConsumption.create({ data: {
      evidenceId: 'return-515-prior-finalization', creditInvoiceId: priorCredit.id,
      originalInvoiceId: priorCommercial.id, originalLineId: 'return-515-invoice-row',
      productRowId: financialStone.productRowId!, quantity: '3',
    } });
    const withPrevious = await call(financialPath);
    assert.equal(withPrevious.data.items[0].candidates[0].remainingQuantity, '5.000');
    const draft = (quantity: string, financialLineId = candidate.financialLineId) => ({
      expectedVersionId: financialCase.data.version.id, expectedDraftNumber: 0,
      items: [{ itemId: financialItem.id, agreedUnitRateRials: '6000000',
        rows: [{ financialRecordId: candidate.financialRecordId, financialLineId, quantity }] }],
    });
    assert.equal((await call(`${financialPath}/allocations`, draft('7'), 'PUT')).status, 409);
    assert.equal((await call(`${financialPath}/allocations`, draft('5.5'), 'PUT')).status, 409);
    assert.equal((await call(`${financialPath}/allocations`, draft('1', 'unrelated-accounting-row'), 'PUT')).status, 409);
    assert.equal((await call(`${financialPath}/allocations`, draft('4'), 'PUT')).status, 200);
    const savedReview = await call(financialPath);
    assert.equal(savedReview.data.items[0].candidates[0].draftRemainingQuantity, '1.000');
    assert.equal(savedReview.data.items[0].rows[0].financialRecordId, financialRecord.id);
    assert.equal(savedReview.data.items[0].rows[0].quantity, '4.000');

    const linearContract = await db.salesContract.findUniqueOrThrow({
      where: { contractNumber: 'SECRET-RETURN-507' }, include: { items: { where: { productRowId: 'length' } } },
    });
    const [linearStone] = linearContract.items;
    const linearRecord = await db.accountingFinancialRecord.create({ data: {
      kind: 'INVOICE_CANDIDATE', status: 'ISSUED', sourceKind: 'SALES_CONTRACT', contractId: linearContract.id,
      sourceId: linearContract.id, customerId: customer.id, systemInvoiceNumber: 'RETURN-515-APPROVED-CAPTURE',
      amount: '48000000', createdBy: actor.id, financiallyApprovedBy: actor.id, financiallyApprovedAt: approvedAt, postedAt: approvedAt,
      sourceSnapshot: { id: linearContract.id, customerId: customer.id, contractData: linearContract.contractData! },
      metadata: { mode: 'FROM_CONTRACT_TOTAL' },
    } });
    const witness = {
      id: 'return-515-capture', contractId: linearContract.id, contractItemId: linearStone.id, productRowId: 'length',
      unit: 'meter', kind: 'CONTRACTED_SET' as const, quantity: '220.000',
      effectiveAt: approvedAt.toISOString(), recordedAt: approvedAt.toISOString(),
      sourceType: 'FINANCIALLY_APPROVED_CONTRACT_QUANTITY_VERSION', sourceId: `${linearRecord.id}:${linearStone.id}`, sourceVersion: 1,
      metadata: { financialRecordId: linearRecord.id, financiallyApprovedAt: approvedAt.toISOString() },
    };
    await db.shipmentQuantityEvidence.create({ data: { ...witness, integrityHash: shipmentQuantityEvidenceIntegrityHash({
      ...witness, integrityHash: '',
    }) } });
    const captureVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '51 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    const captureCase = await call(receipts, { ...command, visitId: captureVisit.data.id, projectIds: [extraProject.id],
      items: [{ productId: lengthProduct.id, unit: 'meter', healthyQuantity: '13.5', damagedQuantity: '0' }] });
    assert.equal(captureCase.status, 201, JSON.stringify(captureCase));
    const captureReview = await call(`/api/accounting/project-returns/${captureCase.data.id}`);
    assert.deepEqual(captureReview.data.items[0].candidates.map((row: { financialLineId: string; remainingQuantity: string }) =>
      [row.financialLineId, row.remainingQuantity]), [['return-515-capture', '220.000']]);

    const pricingContract = await db.salesContract.findUniqueOrThrow({
      where: { contractNumber: 'SECRET-RETURN-507' },
      include: { items: { where: { productId: lengthProduct.id } } },
    });
    const pricingApprovedAt = new Date();
    await db.accountingFinancialRecord.create({ data: {
      kind: 'INVOICE_CANDIDATE', status: 'ISSUED', sourceKind: 'SALES_CONTRACT',
      contractId: pricingContract.id, sourceId: pricingContract.id, customerId: customer.id,
      systemInvoiceNumber: 'RETURN-516-ISSUED', amount: '1800', createdBy: actor.id,
      financiallyApprovedBy: actor.id, financiallyApprovedAt: pricingApprovedAt, postedAt: pricingApprovedAt,
      sourceSnapshot: { id: pricingContract.id, customerId: customer.id, contractData: pricingContract.contractData! },
      invoiceItems: { create: pricingContract.items.map(row => ({
        contractItemId: row.id, productId: lengthProduct.id, description: 'سنگ طولی', quantity: '9', unitPrice: '100', totalPrice: '900',
      })) },
    } });
    const pricingVisit = await call(guard, { source: 'PERSONAL_PICKUP', plate: '52 ب 345 ایران 67', purpose: 'PROJECT_RETURN' });
    const pricingCase = await call(receipts, { ...command, visitId: pricingVisit.data.id, projectIds: [extraProject.id],
      items: [{ productId: lengthProduct.id, unit: 'meter', healthyQuantity: '13.5', damagedQuantity: '2' }],
    });
    assert.equal(pricingCase.status, 201, JSON.stringify(pricingCase));
    const pricingVersion = pricingCase.data.version;
    const pricingItem = pricingVersion.items[0];
    await db.projectReturnAllocationDraft.create({ data: {
      versionId: pricingVersion.id, number: 1, createdBy: actor.id,
      items: [{ itemId: pricingItem.id, agreedUnitRateRials: '24000000', rows: [] }],
    } });
    const pricingPath = `/api/accounting/project-returns/${pricingCase.data.id}`;
    const readLegacyPrice = await call(pricingPath);
    assert.equal(readLegacyPrice.data.items[0].agreedUnitRateRials, null, 'A legacy rate per linear meter must not be read as a rate per square meter');
    assert.equal(readLegacyPrice.data.items[0].legacyRateNeedsReview, true);
    const price = { itemId: pricingItem.id, agreedUnitRateRials: '۲۴۰۰۰۰۰۰', rows: [] };
    const writePrice = (item: object) => call(`${pricingPath}/allocations`, {
      expectedVersionId: pricingVersion.id, expectedDraftNumber: 1, items: [item],
    }, 'PUT');
    assert.equal((await writePrice(price)).status, 400, 'A new linear rate requires an explicit square-meter basis');
    const newPrice = await writePrice({ ...price, agreedRateBasis: 'HEALTHY_SQUARE_METER' });
    assert.equal(newPrice.status, 200, JSON.stringify(newPrice));
    const rereadPrice = (await call(pricingPath)).data.items[0];
    assert.equal(rereadPrice.agreedUnitRateRials, '24000000');
    assert.equal(rereadPrice.agreedRateBasis, 'HEALTHY_SQUARE_METER');
    assert.equal(rereadPrice.legacyRateNeedsReview, false);
    assert.equal(rereadPrice.draftAmountRials, null, 'A rate alone is not an allocated amount');
    assert.equal(rereadPrice.candidates.length, 2, JSON.stringify(rereadPrice));
    const shares = rereadPrice.candidates.map((row: { financialRecordId: string; financialLineId: string }, index: number) => ({
      financialRecordId: row.financialRecordId, financialLineId: row.financialLineId, quantity: index === 0 ? '5' : '8.5',
    }));
    const writeShares = (expectedDraftNumber: number, rows: typeof shares) => call(`${pricingPath}/allocations`, {
      expectedVersionId: pricingVersion.id, expectedDraftNumber,
      items: [{ ...price, agreedRateBasis: 'HEALTHY_SQUARE_METER', rows }],
    }, 'PUT');
    const partialPrice = await writeShares(2, [shares[0], { ...shares[1], quantity: '7.5' }]);
    assert.equal(partialPrice.status, 200, JSON.stringify(partialPrice));
    assert.equal(partialPrice.data.items[0].draftAmountRials, '120000000');
    const allocatedPrice = await writeShares(3, shares);
    assert.equal(allocatedPrice.status, 200, JSON.stringify(allocatedPrice));
    assert.equal(allocatedPrice.data.allocationStatus, 'ALLOCATION_COMPLETE');
    assert.equal(allocatedPrice.data.postingBlock.code, 'FINANCE_CONNECTION_UNAVAILABLE');
    assert.equal(allocatedPrice.data.items[0].draftAmountRials, '129600000');
    const savedPrice = (await call(pricingPath)).data.items[0];
    assert.equal(savedPrice.healthyAreaSquareMeters, '5.4');
    assert.equal(savedPrice.damagedAreaSquareMeters, '0.8');
    assert.equal(savedPrice.draftAmountRials, '129600000');
    assert.equal((await call(`${pricingPath}/finalize`, {})).status, 409);
  } finally {
    try {
      if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      await disconnectRuntime?.();
    } finally {
      if (previousDatabaseUrl) process.env.DATABASE_URL = previousDatabaseUrl;
      else delete process.env.DATABASE_URL;
      try { await db.$disconnect(); } finally { await isolated.cleanup(); }
    }
  }
});
