'use client';
import { ErpWorkspacePage } from '@/components/erp';
import AttendanceRestManager from '@/features/attendance-device/AttendanceRestManager';
export default function AttendanceRestPage() {
  return <ErpWorkspacePage title="استراحت پرسنل" backHref="/dashboard/hr/personnel"><AttendanceRestManager /></ErpWorkspacePage>;
}
