/** Close both retained read-only transports even when ownership is lost. A
 * negative closure remains negative; it cannot authorize resource retirement. */
export async function closeOriginalCompleteClients({issuer,inquiry,assertOwner,persist}){
 const errors=[],value={format:'sabalan-original-complete-linux-client-closure/v1',pass:false,productionAdmission:false};
 const attempt=(name,action)=>{try{value[name]=action();}catch(error){errors.push(error);value[name]={closureFailed:true,errorName:error.name};}};
 attempt('owner',()=>{assertOwner();return{current:true};});
 for(const[name,client]of Object.entries({issuer,inquiry}))if(client)attempt(name,()=>client.close());
 if(issuer&&(!value.issuer||value.issuer.failed!==false||value.issuer.allOriginalHttpReadersClosed!==true))errors.push(Error('ORIGINAL_COMPLETE_ISSUER_CLOSURE_NEGATIVE'));
 if(inquiry&&(!value.inquiry||value.inquiry.failed!==false||value.inquiry.closed!==true))errors.push(Error('ORIGINAL_COMPLETE_INQUIRY_CLOSURE_NEGATIVE'));
 value.pass=errors.length===0;
 let reference;try{reference=await persist(value);}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'ORIGINAL_COMPLETE_CLIENT_CLOSURE_NEGATIVE');
 return reference;
}
