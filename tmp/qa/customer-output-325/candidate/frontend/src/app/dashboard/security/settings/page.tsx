'use client';

import { FaChevronLeft, FaFolderOpen, FaUsers } from 'react-icons/fa';
import { ErpWorkspacePage } from '@/components/erp';
import Link from 'next/link';

const destinations = [
  { title: 'فهرست حضور و غیاب', href: '/dashboard/security/settings/attendance-roster', Icon: FaUsers },
  { title: 'ساختار گزارش شیفت', href: '/dashboard/security/settings/report-structure', Icon: FaFolderOpen },
];

export default function SecuritySettingsPage() {
  return <ErpWorkspacePage className="guard-workspace" title="تنظیمات گارد"> <nav className="sds-neumorphic-card divide-y divide-[var(--sds-border-subtle)] overflow-hidden" aria-label="بخش‌های تنظیمات">{destinations.map(({ title, href, Icon }) => <Link key={href} href={href} className="group flex min-h-16 items-center gap-3 px-4 outline-none transition hover:bg-[var(--sds-surface-subtle)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sds-focus-ring)]"><span className="sds-neumorphic-icon inline-flex h-11 w-11 items-center justify-center text-[var(--sds-accent)]"><Icon /></span><span className="flex-1 font-bold sds-text-primary ">{title}</span><FaChevronLeft className="sds-text-muted transition-transform group-hover:-translate-x-1" /></Link>)}</nav></ErpWorkspacePage>;
}
