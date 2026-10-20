import path from 'node:path';
import {createHash} from 'node:crypto';
import {HR_PERSONNEL_ERASURE_STORAGE_ROOTS} from './hrPersonnelErasureGraph';
import {DOCUMENT_PDF_RETAINED_ROOTS} from './documentPdfFileRuntime';
import {DISPATCH_DOCUMENT_STORAGE_ROOT} from './dispatchFileRuntime';
import {performanceExportStorageDirectory} from './performanceFileRuntime';
import {supportTicketStorageDirectory} from './supportFileRuntime';

export function protectedLegacyFileRoots(){
 const lives=[...new Set([...HR_PERSONNEL_ERASURE_STORAGE_ROOTS,...DOCUMENT_PDF_RETAINED_ROOTS,DISPATCH_DOCUMENT_STORAGE_ROOT,performanceExportStorageDirectory(),supportTicketStorageDirectory()])].sort();
 if(process.cwd()!=='/app'||lives.length!==9)throw Error('PROTECTED_FILE_ROOT_SET_INVALID');
 return Object.freeze(lives.map(liveRoot=>Object.freeze({liveRoot,root:path.join('/app/recovery-coordination/online-file-versions',createHash('sha256').update(liveRoot).digest('hex'))})));
}
