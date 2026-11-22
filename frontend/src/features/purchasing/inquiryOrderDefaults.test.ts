import assert from 'node:assert/strict';
import {offerKnownCost,inquiryOrderDefaults} from './inquiryOrderDefaults';
assert.deepEqual(offerKnownCost('500000','40','1000000'),{material:'20000000',total:'21000000'});
assert.deepEqual(offerKnownCost('500000','40',null),{material:'20000000',total:null});
assert.equal(offerKnownCost(null,'40','0'),null);
assert.deepEqual(offerKnownCost('100000000000000000000','0.000000000000000000000000000001','0'),{material:'0.0000000001',total:'0.0000000001'});
const request:any={id:'r',data:{inquirySelection:[{supplierId:'A',inquiryId:'i',offerId:'q',quantity:'0.000000000000000000000000000003',price:'1'}]}};
const defaults=inquiryOrderDefaults(request,[{status:'OPEN',data:{supplierId:'A',effectiveAllocations:[{requestId:'r',quantity:'0.000000000000000000000000000001',quoteBindings:[{inquiryId:'i',offerId:'q',quantity:'0.000000000000000000000000000001'}]}]}} as any]);
assert.equal(defaults?.quantity,'0.000000000000000000000000000002');
// Server commitments cover orders outside the currently displayed page.
const authoritative:any={id:'r',data:{quantity:'1',purchaseQuantity:'3',inquirySelection:[
  {supplierId:'A',inquiryId:'i',offerId:'old',quantity:'1',price:'2'},
  {supplierId:'B',inquiryId:'i',offerId:'new',quantity:'2',price:'3',offerSnapshot:{terms:'نقدی',arrivalDate:'2026-11-05'}}
]},progress:{purchaseOrdered:'1',ordered:'0.333333333333333333333333333333'},quoteCommitments:[{inquiryId:'i',offerId:'old',quantity:'1'}],quoteAvailability:[{inquiryId:'i',offerId:'old',quantity:'0'},{inquiryId:'i',offerId:'new',quantity:'2'}]};
const remainder=inquiryOrderDefaults(authoritative,[]);
assert.equal(remainder?.supplierId,'B');
assert.equal(remainder?.quantity,'2');
assert.equal(remainder?.demandQuantity,'0.666666666666666666666666666667');
assert.equal(remainder?.paymentTerms,'نقدی');
assert.equal(remainder?.date,'2026-11-05');
authoritative.quoteAvailability[1].quantity='0';
assert.equal(inquiryOrderDefaults(authoritative,[],'B')?.quantity,'0');
console.log('Purchasing inquiry defaults/costs: 11 exactness and authority checks passed.');
