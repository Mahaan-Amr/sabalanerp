import {draftRecord} from '@/lib/modelDraft';
export const followUpDraftFields=['customerId','potentialProjectId','communicationType','workType','happenedAt','summary','outcome','noNextActionReason','nextTitle','nextCommunicationType','nextDueAt','nextInstructions'] as const;
export function parseFollowUpDraft(value:unknown){return draftRecord(value,followUpDraftFields,['hasNextAction']) as Record<typeof followUpDraftFields[number],string>&{hasNextAction:boolean};}
