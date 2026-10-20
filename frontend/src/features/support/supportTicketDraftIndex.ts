type Pointer={id:string;userId:string;capturedAt:string};
export type SupportDraftCursor={id:string;capturedAt:string};
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  const request=indexedDB.open('sabalan-support-draft-index',1);let refused=false;
  request.onupgradeneeded=()=>{const store=request.result.createObjectStore('archives',{keyPath:'id'});store.createIndex('ownerTime',['userId','capturedAt','id']);};
  request.onerror=()=>reject(Error('SUPPORT_INDEX_UNVERIFIED'));request.onblocked=()=>{refused=true;reject(Error('SUPPORT_INDEX_BLOCKED'));};
  request.onsuccess=()=>{if(refused){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
});}
const complete=(transaction:IDBTransaction)=>new Promise<void>((resolve,reject)=>{
  transaction.oncomplete=()=>resolve();transaction.onabort=transaction.onerror=()=>reject(Error('SUPPORT_INDEX_UNVERIFIED'));
});
export async function indexSupportDraft(pointer:Pointer,assertCurrent:()=>void){
  assertCurrent();const database=await open();
  try{
    assertCurrent();const write=database.transaction('archives','readwrite',{durability:'strict'}),written=complete(write);
    if(write.durability!=='strict'){write.abort();await written.catch(()=>{});throw Error('SUPPORT_INDEX_DURABILITY_UNPROVEN');}
    write.objectStore('archives').add({...pointer});await written;assertCurrent();
    const read=database.transaction('archives','readonly'),done=complete(read),request=read.objectStore('archives').get(pointer.id);
    await done;assertCurrent();if(JSON.stringify(request.result)!==JSON.stringify(pointer))throw Error('SUPPORT_INDEX_UNVERIFIED');
  }finally{database.close();}
}
export async function readSupportDraftIndex(userId:string,assertCurrent:()=>void,before?:SupportDraftCursor){
  assertCurrent();const database=await open();
  try{
    assertCurrent();const transaction=database.transaction('archives','readonly'),done=complete(transaction),pointers:Pointer[]=[];
    const range=IDBKeyRange.bound([userId,'',''],before?[userId,before.capturedAt,before.id]:[userId,'\uffff','\uffff'],false,Boolean(before));
    const request=transaction.objectStore('archives').index('ownerTime').openCursor(range,'prev');let more=false;
    request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;if(pointers.length===20){more=true;return;}
      pointers.push(cursor.value);cursor.continue();};
    await done;assertCurrent();
    for(const value of pointers)if(value.userId!==userId||!/^[a-f0-9-]{36}$/.test(value.id)||!Number.isFinite(Date.parse(value.capturedAt)))throw Error('SUPPORT_INDEX_UNVERIFIED');
    const last=pointers[pointers.length-1];return {pointers,next:more?{id:last.id,capturedAt:last.capturedAt}:null};
  }finally{database.close();}
}
