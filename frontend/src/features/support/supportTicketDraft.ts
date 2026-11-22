import type { BrowserEvidenceReference, BrowserEvidenceScope } from '@/lib/browserEvidenceArchive';
export type SupportForm = { title: string; type: string; impact: string; workaroundExists: boolean;
  reportedWorkspace: string; reportedFeature: string; description: string; steps: string; expectedResult: string;
  sensitiveEvidenceConsent: boolean; sensitiveEvidenceText: string };
export type SupportEvidence = { id: string; file: File; kind: 'IMAGE' | 'AUDIO' | 'DOCUMENT';
  previewUrl?: string; durationSeconds?: number; transcript?: string };
export type SupportSubmission = { key: string; bodySha256: string; status: 'UNCERTAIN' | 'CONFIRMED' };
export type SupportDraft = { format: 'sabalan-support-draft/v1'; scope: BrowserEvidenceScope; revision: number;
  form: SupportForm; origin: { route: string; pageTitle?: string; buildCommit?: string; viewport?: { width: number; height: number } };
  detailsOpen: boolean; evidence: Array<{ id: string; kind: SupportEvidence['kind']; reference: BrowserEvidenceReference;
    durationSeconds?: number; transcript?: string }>; submission: SupportSubmission | null };
function fail(): never { throw Error('SUPPORT_DRAFT_UNVERIFIED'); }
const exact = (value: any, required: string[], optional: string[] = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.prototype.hasOwnProperty.call(value,key)) && Object.keys(value).every(key => [...required,...optional].includes(key));
const identifier = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export function supportOriginForArchive(origin: any): SupportDraft['origin'] {
  if (origin?.sensitiveCandidate) throw Error('SUPPORT_AUTOMATIC_SENSITIVE_ORIGIN_REVIEW_REQUIRED');
  return { route: String(origin?.route || '/dashboard').split(/[?#]/,1)[0],
    ...(origin?.pageTitle ? { pageTitle: origin.pageTitle } : {}), ...(origin?.buildCommit ? { buildCommit: origin.buildCommit } : {}),
    ...(origin?.viewport ? { viewport: { width: origin.viewport.width, height: origin.viewport.height } } : {}) };
}
export function parseSupportDraft(payloadJson: string): SupportDraft {
  if (new TextEncoder().encode(payloadJson).length > 256*1024) fail();
  const value = JSON.parse(payloadJson);
  if (!exact(value,['format','scope','revision','form','origin','detailsOpen','evidence','submission'])
    || value.format!=='sabalan-support-draft/v1' || !exact(value.scope,['userId','sessionId','tabId','draftId'])
    || Object.values(value.scope).some(field=>!identifier(field)) || !Number.isSafeInteger(value.revision)||value.revision<0
    || typeof value.detailsOpen!=='boolean') fail();
  const lengths: Record<string,number> = {title:180,type:40,impact:40,reportedWorkspace:128,reportedFeature:128,
    description:10000,steps:5000,expectedResult:5000,sensitiveEvidenceText:20000};
  if (!exact(value.form,[...Object.keys(lengths),'workaroundExists','sensitiveEvidenceConsent'])
    || Object.entries(lengths).some(([key,max])=>typeof value.form[key]!=='string'||value.form[key].length>max)
    || typeof value.form.workaroundExists!=='boolean'||typeof value.form.sensitiveEvidenceConsent!=='boolean'
    || !['TECHNICAL_ERROR','INCORRECT_DATA','ACCESS_PROBLEM','GUIDANCE','IMPROVEMENT','SECURITY_PRIVACY','OTHER'].includes(value.form.type)
    || !['MINOR','SINGLE_TASK','BLOCKED','WIDESPREAD'].includes(value.form.impact)) fail();
  if (!exact(value.origin,['route'],['pageTitle','buildCommit','viewport']) || typeof value.origin.route!=='string'
    || !value.origin.route.startsWith('/') || value.origin.route.length>2000 || /[?#]/.test(value.origin.route)
    || ['pageTitle','buildCommit'].some(key=>value.origin[key]!==undefined&&(typeof value.origin[key]!=='string'||value.origin[key].length>512))) fail();
  if (value.origin.viewport!==undefined && (!exact(value.origin.viewport,['width','height'])
    || Object.values(value.origin.viewport).some(number=>!Number.isSafeInteger(number)||Number(number)<1||Number(number)>100000))) fail();
  if (!Array.isArray(value.evidence)||value.evidence.length>5||new Set(value.evidence.map((item:any)=>item.id)).size!==value.evidence.length) fail();
  for (const item of value.evidence) {
    if (!exact(item,['id','kind','reference'],['durationSeconds','transcript'])||!identifier(item.id)
      || !['IMAGE','AUDIO','DOCUMENT'].includes(item.kind)||!item.reference
      || !exact(item.reference,['userId','sessionId','tabId','draftId','format','id','capturedAt','name','type','size','lastModified','sha256','metadataSha256'])
      || item.reference.format!=='sabalan-browser-evidence/v1'||!/^[a-f0-9-]{36}$/.test(item.reference.id)
      || !Number.isFinite(Date.parse(item.reference.capturedAt))
      || typeof item.reference.name!=='string'||!item.reference.name||item.reference.name.length>512
      || typeof item.reference.type!=='string'||item.reference.type.length>256
      || !Number.isSafeInteger(item.reference.size)||item.reference.size<1||item.reference.size>25*1024*1024
      || !Number.isSafeInteger(item.reference.lastModified)||item.reference.lastModified<0
      || !/^[a-f0-9]{64}$/.test(item.reference.sha256)||!/^[a-f0-9]{64}$/.test(item.reference.metadataSha256)
      || ['userId','sessionId','tabId','draftId'].some(key=>item.reference[key]!==value.scope[key])
      || item.durationSeconds!==undefined&&(!Number.isSafeInteger(item.durationSeconds)||item.durationSeconds<1||item.durationSeconds>600)
      || item.transcript!==undefined&&(typeof item.transcript!=='string'||item.transcript.length>20000)) fail();
  }
  if (value.submission!==null && (!exact(value.submission,['key','bodySha256','status'])||!identifier(value.submission.key)
    || !/^[a-f0-9]{64}$/.test(value.submission.bodySha256)||!['UNCERTAIN','CONFIRMED'].includes(value.submission.status))) fail();
  return value;
}
export function assertSupportRestoreAllowed(draft: SupportDraft, current: {userId:string;sessionId:string;tabId?:string}, empty: boolean, reviewed: boolean) {
  if (draft.scope.userId!==current.userId || !empty || ((draft.scope.sessionId!==current.sessionId
    ||current.tabId!==undefined&&draft.scope.tabId!==current.tabId)&&!reviewed)) fail();
}
export const supportFormEmpty=(form:SupportForm,evidence:SupportEvidence[],initialWorkspace='')=>!form.title&&!form.description&&!form.steps
  &&!form.expectedResult&&!form.sensitiveEvidenceText&&!form.workaroundExists&&form.type==='TECHNICAL_ERROR'
  &&form.impact==='SINGLE_TASK'&&form.reportedWorkspace===initialWorkspace&&!form.reportedFeature&&evidence.length===0;
