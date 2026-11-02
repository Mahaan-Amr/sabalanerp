import {purchasingCatalog} from '../services/purchasing/catalog';
import { contractPurchaseEntry, compatibleContractInquiries } from '../services/purchasing/contractEntry';
import express, { type Response } from 'express';
import multer from 'multer';
import {createHash} from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { protect, type AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { executePurchasing } from '../services/purchasing/service';
import { purchasingWorkspace, purchasingLookups, purchasingDetail } from '../services/purchasing/read';
import { PurchasingError } from '../services/purchasing/domain';
import { document } from '../services/purchasing/repository';
import { renderPurchaseOrder } from '../services/purchasing/print';
import { generatePdfBufferFromHtml } from '../utils/pdf';
import { accessFor, assertCapability, purchasingSections } from '../services/purchasing/access';
import { SupplyChainAccountingError } from '../services/accountingSupplyChain';
import {AccountingLedgerError} from '../services/accountingLedgerFoundation';
import {scanPurchaseAttachment,validatePurchaseAttachment} from '../services/purchasing/attachments';
import {canReadDocument} from '../services/purchasing/access';
const router = express.Router();
router.use(protect);
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
const actor = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });
const handle = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) => (req: AuthRequest, res: Response) => { void fn(req, res).catch(error => {
  if (error instanceof PurchasingError || error instanceof SupplyChainAccountingError || error instanceof AccountingLedgerError) return res.status(error.status).json({ success: false, code: error.code, message: error.message, fields: error instanceof PurchasingError && error.field ? { [error.field]: error.message } : {} });
  const traceId = randomUUID(), traceCode=String(BigInt('0x'+traceId.slice(0,8))); console.error('Purchasing operation failed', { traceId, traceCode, error });
  return res.status(500).json({ success: false, code: 'PURCHASING_OPERATION_FAILED', traceId:traceCode, message: `عملیات کامل نشد. نوشته‌های شما حفظ شده است؛ نتیجه ثبت قبلی را بررسی کنید. کد پیگیری خرید: ${traceCode}` });
}); };
router.get('/inquiries/:id/compatible',handle(async(req,res)=>res.json({success:true,data:await compatibleContractInquiries(actor(req),req.params.id)})));
router.get('/catalog',handle(async(req,res)=>res.json({success:true,data:await purchasingCatalog(actor(req),String(req.query.q||''),String(req.query.cursor||''),undefined,String(req.query.family||''))})));
router.get('/access',handle(async(req,res)=>{const access=await accessFor(prisma,actor(req));return res.json({success:true,data:{access,sections:purchasingSections(access)}});}));
router.get('/contract-entry', handle(async (req, res) => res.json({ success: true, data: await contractPurchaseEntry(actor(req), String(req.query.contractId || ''), String(req.query.rowId || '')) })));
router.get('/workspace', handle(async (req, res) => res.json({ success: true, data: await purchasingWorkspace(actor(req), String(req.query.q || '')) })));
router.get('/lookups', handle(async (req, res) => res.json({ success: true, data: await purchasingLookups(actor(req), String(req.query.q || ''), String(req.query.kind || 'contracts'), String(req.query.sourceId || '')) })));
router.get('/documents/:id/pdf', handle(async (req, res) => {
  const access = await accessFor(prisma, actor(req)); assertCapability(access.prices);
  const doc = await document(prisma, req.params.id, 'ORDER');
  const pdf = await generatePdfBufferFromHtml({ htmlContent: renderPurchaseOrder(doc), landscape: false, displayHeaderFooter: false, margin: { top: '8mm', bottom: '10mm', left: '6mm', right: '6mm' } });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="purchase-order-${doc.number}.pdf"`); return res.send(pdf);
}));
router.get('/documents/:id', handle(async (req, res) => res.json({ success: true, data: await purchasingDetail(actor(req), req.params.id) })));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1,fields:4}}).single('file');
router.post('/documents/:id/attachments',async(req:AuthRequest,res,next)=>{
  try{const access=await accessFor(prisma,actor(req));const doc=await document(prisma,req.params.id);assertCapability(await canReadDocument(prisma,access,doc));}
  catch(error){return handle(async()=>{throw error;})(req,res);}
  return upload(req,res,error=>{if(error)return res.status(400).json({success:false,code:'INVALID_ATTACHMENT',message:'فایل باید تصویر یا PDF معتبر و حداکثر ۱۰ مگابایت باشد.'});return next();});
},handle(async(req,res)=>{
  if(!req.file)throw new PurchasingError('FILE_REQUIRED','فایل تصویر یا PDF را انتخاب کنید.',400,'file');
  validatePurchaseAttachment(req.file.buffer,req.file.mimetype);
  const scanStatus=await scanPurchaseAttachment(req.file.buffer);
  if(req.aborted||res.destroyed)return;
  const data=await executePurchasing(actor(req),String(req.get('Idempotency-Key')||''),'ATTACHMENT_UPLOAD',{documentId:req.params.id,expectedVersion:Number(req.body.expectedVersion),visibility:req.body.visibility,originalName:req.file.originalname,mimeType:req.file.mimetype,sha256:createHash('sha256').update(req.file.buffer).digest('hex'),bytes:req.file.buffer,scanStatus});
  return res.json({success:true,data});
}));
router.get('/attachments/:id',handle(async(req,res)=>{
  const access=await accessFor(prisma,actor(req)),attachment=await prisma.purchasingAttachment.findUnique({where:{id:req.params.id}});
  if(!attachment)throw new PurchasingError('ATTACHMENT_NOT_FOUND','پیوست پیدا نشد؛ فهرست پرونده را تازه کنید.',404);
  const doc=await document(prisma,attachment.documentId);assertCapability(await canReadDocument(prisma,access,doc));assertCapability(attachment.visibility!=='COMMERCIAL'||access.prices);
  res.setHeader('X-Content-Type-Options','nosniff');res.type(attachment.mimeType);res.attachment(attachment.originalName);return res.send(attachment.bytes);
}));
router.post('/commands', handle(async (req, res) => {
  const data = await executePurchasing(actor(req), String(req.get('Idempotency-Key') || ''), String(req.body.type || ''), req.body.input || {});
  return res.json({ success: true, data });
}));
router.get('/commands/:key', handle(async (req, res) => {
  await accessFor(prisma, actor(req));
  const outcome = await prisma.purchasingCommand.findUnique({ where: { actorId_key: { actorId: req.user!.id, key: req.params.key } } });
  if(outcome){const access=await accessFor(prisma,actor(req)),result=outcome.result as Record<string,any>;if(result.supplier)assertCapability(access.buyer);if(result.id)assertCapability(await canReadDocument(prisma,access,await document(prisma,result.id)));}
  return res.json({ success: true, data: outcome ? { state: 'APPLIED', result: outcome.result } : { state: 'NOT_FOUND' } });
}));
export default router;
