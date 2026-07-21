import { redirect } from 'next/navigation';

export default function LegacyPersonnelPage() {
  redirect('/dashboard/hr/personnel');
}
