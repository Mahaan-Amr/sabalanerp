'use client';

import { FaChevronLeft, FaFolderOpen, FaUsers } from 'react-icons/fa';
import { ErpWorkspacePage } from '@/components/erp';
import Link from 'next/link';

const destinations = [
  { title: 'فهرست حضور و غیاب', href: '/dashboard/security/settings/attendance-roster', Icon: FaUsers },
  { title: 'ساختار گزارش شیفت', href: '/dashboard/security/settings/report-structure', Icon: FaFolderOpen },
];

export default function SecuritySettingsPage() {
  return <ErpWorkspacePage title="تنظیمات حراست"> <nav className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/70" aria-label="بخش‌های تنظیمات">{destinations.map(({ title, href, Icon }) => <Link key={href} href={href} className="group flex min-h-16 items-center gap-3 px-4 outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#074747] dark:hover:bg-slate-800/60"><span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-[#074747] dark:bg-slate-800 dark:text-teal-200"><Icon /></span><span className="flex-1 font-bold text-slate-950 dark:text-white">{title}</span><FaChevronLeft className="text-slate-400 transition-transform group-hover:-translate-x-1" /></Link>)}</nav></ErpWorkspacePage>;
}
