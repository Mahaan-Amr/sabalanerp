/** Recover EDIT ownership before applying any draft state; never turn edits into adds. */
export function recoverContractModalIdentity(modal:Record<string,unknown>,payments:Array<{id:string}>,products:Array<{rowId?:string}>){
 // Closed editors carry no edit action; retained legacy display snapshots must
 // not prevent recovery of the actual wizard or manufacture a future edit.
 modal={...modal,...(modal.showPaymentEntryModal===false?{editingPaymentEntryId:null,paymentEntryForm:{}}:{}),...(modal.showProductModal===false?{isEditMode:false,editingProductIndex:null,editingProductRowId:null,productConfig:{}}:{})};
 const paymentForm=modal.paymentEntryForm as {id?:unknown}|undefined;
 const paymentId=modal.editingPaymentEntryId===undefined?paymentForm?.id??null:modal.editingPaymentEntryId;
 if(paymentId!==null&&(typeof paymentId!=='string'||!paymentId||payments.filter(row=>row.id===paymentId).length!==1))throw Error('CONTRACT_PAYMENT_EDIT_IDENTITY_UNPROVEN');
 if(paymentForm?.id!==undefined&&paymentId!==paymentForm.id)throw Error('CONTRACT_PAYMENT_EDIT_IDENTITY_MISMATCH');
 const config=modal.productConfig as {rowId?:unknown}|undefined;
 const legacyRow=config?.rowId;
 const explicitMode=modal.isEditMode;
 if(explicitMode!==undefined&&typeof explicitMode!=='boolean')throw Error('CONTRACT_PRODUCT_EDIT_MODE_INVALID');
 if(explicitMode===undefined&&typeof legacyRow==='string'&&products.some(row=>row.rowId===legacyRow))throw Error('CONTRACT_LEGACY_PRODUCT_EDIT_MODE_UNPROVEN');
 const isEditMode=explicitMode??false;
 const productRowId=modal.editingProductRowId===undefined?(isEditMode?legacyRow:null):modal.editingProductRowId;
 let editingProductIndex:number|null=null;
 if(isEditMode){
  if(typeof productRowId!=='string'||!productRowId||products.filter(row=>row.rowId===productRowId).length!==1)throw Error('CONTRACT_PRODUCT_EDIT_IDENTITY_UNPROVEN');
  editingProductIndex=products.findIndex(row=>row.rowId===productRowId);
  if(modal.editingProductIndex!==undefined&&modal.editingProductIndex!==editingProductIndex)throw Error('CONTRACT_PRODUCT_EDIT_INDEX_CHANGED');
  if(legacyRow!==undefined&&legacyRow!==productRowId)throw Error('CONTRACT_PRODUCT_EDIT_IDENTITY_MISMATCH');
 }else if(productRowId!==null||modal.editingProductIndex!==undefined&&modal.editingProductIndex!==null)throw Error('CONTRACT_PRODUCT_ADD_IDENTITY_MISMATCH');
 return {editingPaymentEntryId:paymentId as string|null,isEditMode,editingProductIndex};
}
