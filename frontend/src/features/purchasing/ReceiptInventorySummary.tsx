'use client';
import {ErpCard,ErpFieldView,ErpBadge} from '@/components/erp';
import {purchaseNumber} from './presentation';
type Custody={quantity:string;reserved:string;free:string;unit:string;valued:boolean};
export function ReceiptInventorySummary({inventory,route}:{inventory:Custody|null;route:string}) {
  if(route==='direct')return <ErpFieldView label="مسیر تحویل" value="تحویل مستقیم به مشتری؛ ورود به انبار سبلان ثبت نمی‌شود."/>;
  if(!inventory)return <ErpFieldView label="سابقه انبار" value="موجودی تازه‌ای از این رسید ثبت نشده است. دریافت‌های قبلی باید به سابقه موجود انبار متصل شوند."/>;
  const value=(q:string)=>`${purchaseNumber(q)} ${inventory.unit}`;
  return <ErpCard className="space-y-3 p-4"><strong>موجودی همین رسید</strong><div className="grid gap-3 sm:grid-cols-3"><ErpFieldView label="موجودی پذیرفته‌شده" value={value(inventory.quantity)}/><ErpFieldView label="محفوظ برای قرارداد" value={value(inventory.reserved)}/><ErpFieldView label="موجودی آزاد" value={value(inventory.free)}/></div><ErpBadge tone={inventory.valued?'success':'warning'}>{inventory.valued?'ارزش‌گذاری حسابداری دارد':'هنوز ارزش‌گذاری حسابداری نشده است'}</ErpBadge></ErpCard>;
}
