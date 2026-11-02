import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {assertCapability,canReadDocument,type Access,type Actor} from './access';
import {PurchasingError,required,type JsonObject} from './domain';
import {document,updateDocument,type Tx} from './repository';

const MAX=10*1024*1024;
export function validatePurchaseAttachment(bytes:Buffer,mime:string) {
  const valid=mime==='application/pdf'?bytes.subarray(0,5).toString('ascii')==='%PDF-':mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
  if(!bytes.length||bytes.length>MAX||!valid)throw new PurchasingError('INVALID_ATTACHMENT','فایل باید تصویر یا PDF معتبر و حداکثر ۱۰ مگابایت باشد.',400,'file');
}

/** Uses the same installed ClamAV daemon/config as platform uploads, with stdin.
 * No temporary filesystem, shell interpolation or unscanned fallback. */
export async function scanPurchaseAttachment(bytes:Buffer) {
  return new Promise<'CLEAN'>((resolve,reject)=>{
    const child=spawn('clamdscan',['--config-file=/etc/clamav/clamd-remote.conf','--stream','--no-summary','-'],{stdio:['pipe','ignore','ignore']});
    let finished=false;
    const finish=(code:number|null)=>{if(finished)return;finished=true;clearTimeout(timer);if(code===0)resolve('CLEAN');else reject(new PurchasingError(code===1?'ATTACHMENT_INFECTED':'ATTACHMENT_SCAN_UNAVAILABLE',code===1?'فایل در بررسی امنیتی رد شد؛ فایل سالم دیگری انتخاب کنید.':'بررسی امنیتی فایل فعلاً در دسترس نیست؛ فایل ثبت نشد. کمی بعد دوباره تلاش کنید.',code===1?400:503,'file'));};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(null);},30000);
    child.on('error',()=>finish(null));child.on('close',finish);child.stdin.on('error',()=>finish(null));child.stdin.end(bytes);
  });
}

export async function attachmentCommand(tx:Tx,actor:Actor,access:Access,input:JsonObject) {
  // Public JSON command bodies cannot manufacture an in-process Buffer. Only
  // the scanned multipart adapter invokes this command with bytes.
  if(!Buffer.isBuffer(input.bytes)||input.scanStatus!=='CLEAN')throw new PurchasingError('SCANNED_UPLOAD_REQUIRED','پیوست را از بخش فایل‌های همین پرونده بارگذاری کنید.',400);
  validatePurchaseAttachment(input.bytes,input.mimeType);
  const doc=await document(tx,required(input.documentId,'documentId','پرونده'));
  assertCapability(await canReadDocument(tx,access,doc));
  assertCapability(access.buyer||access.receiver&&['RECEIPT','WAREHOUSE_TRANSFER'].includes(doc.kind)||doc.creatorId===actor.id&&access.requester);
  if(doc.version!==input.expectedVersion)throw new PurchasingError('VERSION_CONFLICT','پرونده تغییر کرده است؛ اطلاعات تازه را بررسی و فایل را دوباره ثبت کنید.');
  const visibility=input.visibility==='SPECIFICATION'?'SPECIFICATION':'COMMERCIAL';
  assertCapability(visibility!=='COMMERCIAL'||access.prices);
  const sha256=createHash('sha256').update(input.bytes).digest('hex');
  const prior=await tx.purchasingAttachment.findUnique({where:{documentId_sha256:{documentId:doc.id,sha256}}});
  if(prior)return doc;
  if(await tx.purchasingAttachment.count({where:{documentId:doc.id}})>=50)throw new PurchasingError('ATTACHMENT_LIMIT','این پرونده به سقف ۵۰ پیوست رسیده است؛ پیوست‌های موجود را بررسی کنید.');
  let name=required(input.originalName,'file','نام فایل');
  if([...name].every(c=>c.charCodeAt(0)<=255)&&/[^\x00-\x7f]/.test(name)) {
    const decoded=Buffer.from(name,'latin1').toString('utf8');if(!decoded.includes('\ufffd'))name=decoded;
  }
  const originalName=name.replace(/[\u0000-\u001f\u007f/\\]/g,'_').slice(0,180);
  const attachment=await tx.purchasingAttachment.create({data:{documentId:doc.id,originalName,mimeType:input.mimeType,size:input.bytes.length,sha256,visibility,bytes:input.bytes,scanStatus:'CLEAN',createdBy:actor.id}});
  return updateDocument(tx,actor.id,doc,'ATTACHMENT_ADDED',{...doc.data,attachmentCount:(doc.data.attachmentCount||0)+1,lastAttachment:{id:attachment.id,name:originalName,sha256,visibility}},doc.version);
}
