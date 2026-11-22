'use client';
import type {ReactNode} from 'react';
import {ErpDisclosure} from '@/components/erp';
/** Presentation groups retain each underlying row and quantity. */
export function PurchaseGroups<T extends {key?:string;id?:string;productCode?:string;stone:string}>({rows,children}:{rows:T[];children:(row:T)=>ReactNode}) {
  const groups=new Map<string,T[]>();
  for(const row of rows){const key=row.productCode?`${row.productCode}:${row.stone}`:String(row.key||row.id);groups.set(key,[...(groups.get(key)||[]),row]);}
  return <>{Array.from(groups.entries()).map(([key,members])=>members.length===1?<div key={key}>{children(members[0])}</div>:<ErpDisclosure key={key} title={`${members[0].stone} · ${members.length.toLocaleString('fa-IR')} ردیف`}><div className="space-y-3">{members.map(row=><div key={row.key||row.id}>{children(row)}</div>)}</div></ErpDisclosure>)}</>;
}
