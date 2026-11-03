/** Dispatch by private token membership, never report format or caller JSON. */
import {isOriginalSameComposePhysical,readOriginalSameComposePhysical} from './original-same-compose-physical.mjs';
import {readOriginalIndependentPhysicalRestoreSshCompletion} from './independent-full-restore-ssh.mjs';
export function readOriginalPhysicalCompletion(token){return isOriginalSameComposePhysical(token)?readOriginalSameComposePhysical(token):readOriginalIndependentPhysicalRestoreSshCompletion(token);}
