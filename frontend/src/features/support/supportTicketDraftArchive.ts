import { archiveBrowserDraft, readBrowserWorkflowDraftArchives, type BrowserWorkflowDraftCursor } from '@/lib/browserDraftArchive';
import { readBrowserEvidence } from '@/lib/browserEvidenceArchive';
import { parseSupportDraft, type SupportDraft, type SupportEvidence } from './supportTicketDraft';
import {indexSupportDraft} from './supportTicketDraftIndex';
export type SupportDraftCursor = BrowserWorkflowDraftCursor;
export async function verifySupportDraftEvidence(payloadJson: string, assertCurrent: () => void) {
  const draft=parseSupportDraft(payloadJson);assertCurrent();
  for(const item of draft.evidence) { await readBrowserEvidence(draft.scope,item.reference,assertCurrent);assertCurrent(); }
}
export async function archiveSupportDraft(draft: SupportDraft, buildId: string, assertCurrent: () => void) {
  const payloadJson=JSON.stringify(draft);parseSupportDraft(payloadJson);assertCurrent();
  await verifySupportDraftEvidence(payloadJson,assertCurrent);
  const saved=await archiveBrowserDraft({userId:draft.scope.userId,workflow:'support-ticket',draftId:draft.scope.draftId,
    buildId,schemaVersion:1,baseRevision:draft.revision,payloadJson},assertCurrent);assertCurrent();
  // Separate bounded domain index; original platform v1 databases unchanged.
  await indexSupportDraft({id:saved.id,userId:draft.scope.userId,capturedAt:saved.capturedAt},assertCurrent);
  assertCurrent();return saved;
}
export async function listSupportDrafts(userId:string,assertCurrent:()=>void,before?:SupportDraftCursor) {
  // Global build handoff writes to the original platform archive, without the
  // optional Support index. Discover there so the newest preserved bytes are
  // reachable even before the next domain autosave. Retain index writes above
  // for supported older readers; never require an index migration or repair.
  const {archives,next}=await readBrowserWorkflowDraftArchives(userId,'support-ticket',assertCurrent,before),result=[];
  for(const saved of archives){
    assertCurrent();
    const draft=parseSupportDraft(saved.payloadJson);
    if(saved.workflow!=='support-ticket'||saved.schemaVersion!==1||saved.draftId!==draft.scope.draftId
      ||saved.userId!==userId||saved.userId!==draft.scope.userId||saved.baseRevision!==draft.revision)throw Error('SUPPORT_DRAFT_MANIFEST_UNVERIFIED');
    result.push({id:saved.id,capturedAt:saved.capturedAt,draft});
  }
  return {archives:result,next};
}
export async function readSupportDraftFiles(draft:SupportDraft,assertCurrent:()=>void):Promise<SupportEvidence[]> {
  const result:SupportEvidence[]=[];
  for(const item of draft.evidence){
    const file=await readBrowserEvidence(draft.scope,item.reference,assertCurrent);assertCurrent();
    result.push({id:item.id,file,kind:item.kind,...(item.durationSeconds?{durationSeconds:item.durationSeconds}:{}),
      ...(item.transcript!==undefined?{transcript:item.transcript}:{})});
  }
  return result;
}
