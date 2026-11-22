import {draftRecord} from '@/lib/modelDraft';
export function parseHiringCreateDraft(value:unknown){
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='assessmentDecision,assessmentExecutionMethod,assessmentKinds,form')throw Error('HIRING_DRAFT_FIELDS_INVALID');
 const row=value as {form:unknown;assessmentDecision:unknown;assessmentExecutionMethod:unknown;assessmentKinds:unknown};
 const form=draftRecord(row.form,['firstName','lastName','mobile','nationalCode','positionId']) as {firstName:string;lastName:string;mobile:string;nationalCode:string;positionId:string};
 if(!['','SELECT','NONE'].includes(String(row.assessmentDecision))||!['APPLICANT','COMPANY'].includes(String(row.assessmentExecutionMethod))||!Array.isArray(row.assessmentKinds)||row.assessmentKinds.length>3||row.assessmentKinds.some(value=>!['DISC','EQ','BIG_FIVE'].includes(value))||new Set(row.assessmentKinds).size!==row.assessmentKinds.length)throw Error('HIRING_DRAFT_CHOICES_INVALID');
 return {form,assessmentDecision:row.assessmentDecision as ''|'SELECT'|'NONE',assessmentExecutionMethod:row.assessmentExecutionMethod as 'APPLICANT'|'COMPANY',assessmentKinds:[...row.assessmentKinds] as Array<'DISC'|'EQ'|'BIG_FIVE'>};
}
