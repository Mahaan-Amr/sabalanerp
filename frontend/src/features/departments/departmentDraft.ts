import {draftRecord} from '@/lib/modelDraft';
export type DepartmentDraft={name:string;namePersian:string;description:string;isActive:boolean};
export function parseDepartmentDraft(value:unknown):DepartmentDraft{
  draftRecord(value,['name','namePersian','description'],['isActive']);return value as DepartmentDraft;
}
export function emptyDepartmentDraft(value:DepartmentDraft){return !value.name&&!value.namePersian&&!value.description&&value.isActive;}
