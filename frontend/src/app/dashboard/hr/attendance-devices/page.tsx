'use client';
import { ErpWorkspacePage } from '@/components/erp';
import AttendanceDevicePanel from '@/features/attendance-device/AttendanceDevicePanel';
export default function AttendanceDevicesPage() {
  return <ErpWorkspacePage title="اتصال دستگاه حضور و غیاب"><AttendanceDevicePanel /></ErpWorkspacePage>;
}
