// Three variants of the performance-level badge, switchable via ?variant=, inside the existing Human Resources shell.
import { redirect } from 'next/navigation';

export default function RetiredPerformanceBadgePrototype() {
  redirect('/dashboard/hr/personnel');
}
