import {FaClipboardList,FaTruck,FaBoxOpen} from 'react-icons/fa';
import type {ErpMetric} from '@/components/erp';
import type {PurchaseWorkspace} from './api';
import {purchaseNumber} from './presentation';

/** Dashboard and registers navigate to exactly the same counted populations. */
export function purchaseMetrics(workspace:PurchaseWorkspace):ErpMetric[] {
 return [
  {label:'درخواست نیازمند تأمین در فهرست',value:purchaseNumber(workspace.requests.filter(r=>r.status==='OPEN'&&r.progress.missing!=='0').length),icon:FaClipboardList,tone:'primary',href:'/dashboard/purchasing/requests?view=attention'},
  {label:'سفارش منتظر دریافت در فهرست',value:purchaseNumber(workspace.orders.filter(r=>r.status==='OPEN'&&r.progress.remaining!=='0').length),icon:FaTruck,tone:'info',href:workspace.access.all?'/dashboard/purchasing/orders?view=attention':undefined},
  {label:'رسید منتظر کیفیت در فهرست',value:purchaseNumber(workspace.receipts.filter(r=>r.progress.pending!=='0').length),icon:FaBoxOpen,tone:'warning',href:workspace.access.all?'/dashboard/purchasing/receipts?view=attention':undefined},
 ];
}
