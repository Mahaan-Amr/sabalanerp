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
assert.equal((html.match(/class="invoice-first-page-header"/g) || []).length, 1);
assert.match(html,/شماره فاکتور/);
assert.match(html,/<img /);
assert.ok(!html.includes('برنامه پرداخت'));assert.ok(!html.includes('برنامه تحویل'));
assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
assert.match(html,/۱۲۵ ریال/);assert.match(html,/۱۰۰ ریال/);assert.match(html,/مشخصات راننده/);
assert.match(renderSalesInvoice({...invoice,currency:'toman'}),/۱۲۵ ریال/);
assert.match(renderSalesInvoice({...invoice,replacesNumber:'3'},'ابطال آزمایشی'),/باطل‌شده/);
console.log('operational PDF content, currency, workshop confidentiality and escaped invoice rendering: PASS');
