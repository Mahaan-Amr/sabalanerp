import assert from 'node:assert/strict';
import {renderContractHtml} from '../printTemplate';
import {renderSalesInvoice,type IssuedInvoiceSnapshot} from '../../services/salesDispatchInvoice/render';
import {validFinancialRecord} from '../../services/salesDispatchInvoice/source';
const contract:any={id:'sample',contractNumber:'1024',createdAt:new Date('2026-10-27'),currency:'تومان',totalAmount:1000,
  customer:{firstName:'علی',lastName:'آزمایشی'},items:[{id:'row-1',productRowId:'row-1',product:{namePersian:'سنگ تراورتن'},quantity:2,unitPrice:500,totalPrice:1000}],
  contractData:{project:{projectName:'آفتاب',address:'نشانی آزمایشی'},payment:{payments:[{method:'CASH',amount:1000}]},deliveries:[{deliveryDate:'1405/08/08',products:[{productIndex:0,amount:2,unit:'count'}]}]}};
const production=renderContractHtml(contract,{variant:'production'});
assert.match(production,/قرارداد فروش سنگ/);assert.match(production,/برنامه تحویل/);assert.match(production,/نرخ - ریال/);
assert.ok(!production.includes('برنامه پرداخت'));assert.ok(!production.includes('<h2>امضاها'));
const workshop=renderContractHtml(contract,{variant:'workshop'});
for (const document of [production, workshop]) {
  assert.equal((document.match(/class="first-page-header"/g) || []).length, 1);
  assert.ok(!document.includes('position:fixed'));
}
assert.match(workshop,/برنامه تحویل/);assert.ok(!workshop.includes('برنامه پرداخت'));
assert.ok(!workshop.includes('ریال'));assert.ok(!workshop.includes('تومان'));
assert.ok(!workshop.includes('جمع کل فاکتور'));assert.match(workshop,/نام مشتری/);
assert.equal(validFinancialRecord({kind:'INVOICE_CANDIDATE',status:'DRAFT',financiallyApprovedAt:new Date()}),false);
assert.equal(validFinancialRecord({kind:'INVOICE_CANDIDATE',status:'VOIDED',financiallyApprovedAt:new Date()}),false);
assert.equal(validFinancialRecord({kind:'INVOICE_CANDIDATE',status:'ISSUED',financiallyApprovedAt:null}),false);
assert.equal(validFinancialRecord({kind:'INVOICE_CANDIDATE',status:'POSTED',financiallyApprovedAt:new Date()}),true);
const invoice:IssuedInvoiceSnapshot={schemaVersion:1,loadingId:'loading',loadingNumber:'27',customerId:'customer',customerName:'مشتری <script>',counterparty:'طرف‌حساب',currency:'TOMAN',grossAmount:'12.500000000000',discountAmount:'2.500000000000',netAmount:'10.000000000000',number:'1',issuedAt:'2026-10-27T08:00:00Z',replacesNumber:null,evidence:[],drivers:[{id:'driver',name:'راننده',plate:'۱۲ ب ۳۴۵',waybillNumber:'3'}],lines:[{key:'line',contractNumber:'1024',project:'آفتاب',productRowId:'stable',code:'ST-1',label:'سنگ',length:'1.2',width:'0.4',quantity:'1.25',unit:'m2',grossAmount:'12.500000000000',discountAmount:'2.500000000000',netAmount:'10.000000000000',details:['برش و ابزار'],driverId:'driver'}]};
const html=renderSalesInvoice(invoice);
assert.equal((html.match(/<header>/g) || []).length, 1);
assert.match(html,/شماره فاکتور/);
assert.match(html,/<img /);
assert.ok(!html.includes('برنامه پرداخت'));assert.ok(!html.includes('برنامه تحویل'));
assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
assert.match(html,/مبلغ پرداختنی<\/td><td>۱۰۰<\/td>/);assert.match(html,/مشخصات راننده/);
assert.match(renderSalesInvoice({...invoice,currency:'toman'}),/جمع کل<\/td><td>۱۲۵<\/td>/);
assert.match(renderSalesInvoice({...invoice,replacesNumber:'3'},'ابطال آزمایشی'),/باطل‌شده/);

const linearInvoice = (quantity: string, length: string, count: string, loadedCount?: string) =>
  renderSalesInvoice({
    ...invoice,
    lines: [{ ...invoice.lines[0], length, quantity, unit: 'm' }],
    print: {
      contacts: [],
      contractedGross: {},
      rows: { line: [{ code: 'ST-1', description: 'سنگ', category: 'محصول',
        length, width: '۰٫۴', count, linearMeasurement: '', squareMeasurement: '', rate: '', total: '' }] },
      loadedPieceCounts: loadedCount ? { line: loadedCount } : undefined,
    },
  });
assert.match(linearInvoice('104', '1', '۷۵۰'), /<td>۱<\/td><td>۰٫۴<\/td><td>۱۰۴<\/td><td>۱۰۴<\/td><td>۴۱٫۶<\/td>/);
assert.match(linearInvoice('6', '1٫5', '۲۰', '4'), /<td>۱٫۵<\/td><td>۰٫۴<\/td><td>۴<\/td><td>۶<\/td><td>۲٫۴<\/td>/);
assert.match(linearInvoice('76', '375', ''), /<td>—<\/td><td>۰٫۴<\/td><td>—<\/td><td>۷۶<\/td><td>۳۰٫۴<\/td>/);
assert.match(linearInvoice('76.2', '375', '', '80'), /<td>—<\/td><td>۰٫۴<\/td><td>۸۰<\/td><td>۷۶٫۲<\/td><td>۳۰٫۴۸<\/td>/);
assert.doesNotMatch(linearInvoice('76', '375', ''), /۳۷۵/);
assert.match(linearInvoice('76', '375', ''), /مبلغ پرداختنی<\/td><td>۱۰۰<\/td>/);
console.log('operational PDF content, currency, workshop confidentiality and escaped invoice rendering: PASS');
