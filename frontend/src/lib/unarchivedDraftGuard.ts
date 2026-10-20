import type {BrowserBuildHandoff} from './browserBuildHandoff';

/** Denial only: an archived parent cannot certify an unarchived child buffer.
 * No model, DOM value, credential, authority or storage is captured here. */
export function registerUnarchivedDraftGuard(handoff:Pick<BrowserBuildHandoff,'registerBlocker'>,_workflow:string,_draftId:string,isBlocked:()=>boolean=()=>true){
  return handoff.registerBlocker(isBlocked);
}
