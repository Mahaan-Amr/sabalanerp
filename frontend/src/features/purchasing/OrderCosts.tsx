'use client';
import {ErpDisclosure,ErpButton,ErpCard,ErpField,ErpInput,ErpSearchableSelect} from '@/components/erp';
import type {Option} from './api';
export type OrderCost={title:string;recipientId:string;amount:string};
export function OrderCosts({costs,onChange,suppliers}:{costs:OrderCost[];onChange:(costs:OrderCost[])=>void;suppliers:Option[]}) {
  const patch=(index:number,value:Partial<OrderCost>)=>onChange(costs.map((c,i)=>i===index?{...c,...value}:c));
  return <ErpDisclosure title="هزینه‌های جانبی توافق‌شده"><div className="space-y-4">{costs.map((cost,index)=><ErpCard key={index} className="space-y-3 p-3"><ErpField label="عنوان هزینه" required><ErpInput value={cost.title} onChange={e=>patch(index,{title:e.target.value})}/></ErpField><ErpField label="دریافت‌کننده واقعی هزینه" required><ErpSearchableSelect value={cost.recipientId} onChange={e=>patch(index,{recipientId:e.target.value})} aria-label={`دریافت‌کننده هزینه ${index+1}`}><option value="">انتخاب کنید</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</ErpSearchableSelect></ErpField><ErpField label="مبلغ کل این هزینه (تومان)" required><ErpInput inputMode="decimal" value={cost.amount} onChange={e=>patch(index,{amount:e.target.value})}/></ErpField><ErpButton label="حذف هزینه" variant="ghost" tone="danger" onClick={()=>onChange(costs.filter((_,i)=>i!==index))}/></ErpCard>)}<ErpButton label="افزودن هزینه جانبی" variant="outline" onClick={()=>onChange([...costs,{title:'',recipientId:'',amount:''}])}/></div></ErpDisclosure>;
}
