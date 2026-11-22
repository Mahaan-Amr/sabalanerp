import assert from 'node:assert/strict';
import {test} from 'node:test';
import {purchaseTasks} from './workTasks';
import type {PurchaseWorkspace,PurchaseDocument} from './api';
const doc=(id:string,kind:string,data:Record<string,unknown>,progress:Record<string,unknown>,parentId?:string)=>({id,kind,data,progress,status:'OPEN',parentId} as PurchaseDocument);
const workspace=(patch:Partial<PurchaseWorkspace>={})=>({access:{buyer:true,receiver:true,manager:true},inquiries:[],requests:[],orders:[],receipts:[],exchanges:[],...patch} as PurchaseWorkspace);
test('receiving does not hide unresolved quality and rejected stock prompts physical return before exchange',()=>{
  const receipt=doc('receipt','RECEIPT',{unit:'مترمربع',route:'warehouse'},{pending:'25',toReturn:'0',toExchange:'0'},'order');
  const order=doc('order','ORDER',{unit:'مترمربع',route:'warehouse'},{remaining:'10'});
  assert.deepEqual(purchaseTasks(workspace({receipts:[receipt],orders:[order]})).map(t=>t.action),['ACCEPT']);
  receipt.progress={pending:'0',toReturn:'25',toExchange:'0'};
  assert.equal(purchaseTasks(workspace({receipts:[receipt]}))[0].action,'RETURN');
  receipt.progress={pending:'0',toReturn:'0',toExchange:'25'};
  assert.equal(purchaseTasks(workspace({receipts:[receipt]}))[0].action,'EXCHANGE');
});
test('completed market quotes remain records without a purchase task; new actual needs stay actionable',()=>{
  const completed=doc('market','INQUIRY_CASE',{reason:'market'},{openLines:0});
  const need=doc('need','INQUIRY_CASE',{reason:'stock'},{openLines:1});
  assert.deepEqual(purchaseTasks(workspace({inquiries:[completed,need]})).map(t=>t.document.id),['need']);
});
