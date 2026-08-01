"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, type ComponentType, type ReactNode } from "react";
import { FaChevronLeft } from "react-icons/fa";
import type { ErpTone } from "./index";

type IconType = ComponentType<{ className?: string }>;

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const toneClass: Record<ErpTone, string> = {
  primary: "sds-tone-primary",
  neutral: "sds-tone-neutral",
  success: "sds-tone-success",
  warning: "sds-tone-warning",
  danger: "sds-tone-danger",
  info: "sds-tone-info",
  purple: "sds-tone-purple",
};

export function ErpNeumorphicCard({
  children,
  className,
  as: Element = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "article" | "div" | "section";
}) {
  return (
    <Element className={cx("sds-neumorphic-card", className)}>
      {children}
    </Element>
  );
}

export interface ErpNeumorphicMetric {
  id: string;
  label: string;
  value: ReactNode;
  icon: IconType;
  tone?: ErpTone;
  href?: string;
}

export function ErpNeumorphicMetricGrid({
  items,
}: {
  items: ErpNeumorphicMetric[];
}) {
  return (
    <section
      aria-label="شاخص‌های منابع انسانی"
      className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const tone = item.tone || "primary";
        const content = (
          <>
            <div className="min-w-0">
              <p className="text-xs leading-5 text-[var(--sds-text-secondary)] sm:text-sm">
                {item.label}
              </p>
              <p className="mt-1 text-2xl font-black tabular-nums text-[var(--sds-text-primary)] sm:text-3xl">
                {item.value}
              </p>
            </div>
            <span
              className={cx(
                "sds-neumorphic-icon sds-tone-surface inline-flex h-11 w-11 shrink-0 items-center justify-center sm:h-12 sm:w-12",
                toneClass[tone],
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
          </>
        );
        return item.href ? (
          <Link
            key={item.id}
            href={item.href}
            className="sds-neumorphic-card sds-neumorphic-interactive flex min-h-28 items-center justify-between gap-3 p-4 outline-none sm:min-h-32 sm:p-5"
          >
            {content}
          </Link>
        ) : (
          <ErpNeumorphicCard
            key={item.id}
            as="article"
            className="flex min-h-28 items-center justify-between gap-3 p-4 sm:min-h-32 sm:p-5"
          >
            {content}
          </ErpNeumorphicCard>
        );
      })}
    </section>
  );
}

export interface ErpNeumorphicActionItem {
  id: string;
  title: string;
  description?: string;
  href: string;
  icon: IconType;
}

export function ErpNeumorphicActionGrid({
  title,
  items,
  desktopColumns = 4,
}: {
  title: string;
  items: ErpNeumorphicActionItem[];
  desktopColumns?: 4 | 5;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <h2
        id={titleId}
        className="text-lg font-black text-[var(--sds-text-primary)] sm:text-xl"
      >
        {title}
      </h2>
      <div
        className={cx(
          "grid grid-cols-2 gap-3 xl:gap-4",
          desktopColumns === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4",
        )}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className="sds-neumorphic-card sds-neumorphic-interactive group flex min-h-28 flex-col items-center justify-center gap-3 p-4 text-center outline-none sm:min-h-32"
            >
              <span className="sds-neumorphic-icon inline-flex h-11 w-11 items-center justify-center text-[var(--sds-text-secondary)] transition-colors group-hover:text-[var(--sds-accent)]">
                <Icon className="h-6 w-6" />
              </span>
              <span>
                <span className="block text-base font-bold text-[var(--sds-text-primary)]">
                  {item.title}
                </span>
                {item.description && (
                  <span className="mt-1 hidden text-xs leading-5 text-[var(--sds-text-muted)] sm:block">
                    {item.description}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export interface ErpWorkItem {
  id: string;
  label: string;
  count: number;
  href: string;
  tone?: ErpTone;
}

export function ErpWorkList({
  title,
  items,
}: {
  title: string;
  items: ErpWorkItem[];
}) {
  const titleId = useId();
  return (
    <ErpNeumorphicCard className="h-full min-h-[22rem] overflow-hidden p-4 sm:p-5">
      <h2
        id={titleId}
        className="text-lg font-black text-[var(--sds-text-primary)] sm:text-xl"
      >
        {title}
      </h2>
      <div
        aria-labelledby={titleId}
        className="mt-3 divide-y divide-[var(--sds-border-subtle)]"
      >
        {items.map((item) => {
          const tone = item.tone || (item.count > 0 ? "warning" : "neutral");
          return (
            <Link
              key={item.id}
              href={item.href}
              className="group flex min-h-14 items-center justify-between gap-3 rounded-lg px-1 py-3 outline-none transition-colors hover:text-[var(--sds-accent)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <FaChevronLeft className="h-3.5 w-3.5 shrink-0 text-[var(--sds-text-muted)] transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none" />
                <span className="truncate text-sm font-semibold text-[var(--sds-text-secondary)] sm:text-base">
                  {item.label}
                </span>
              </span>
              <span
                className={cx(
                  "sds-neumorphic-count sds-tone-surface inline-flex min-w-12 items-center justify-center rounded-full px-3 py-1 text-sm font-black tabular-nums",
                  toneClass[tone],
                )}
              >
                {item.count.toLocaleString("fa-IR")}
              </span>
            </Link>
          );
        })}
      </div>
    </ErpNeumorphicCard>
  );
}

export function ErpProgressRingCard({
  title,
  label,
  percentage,
  detail,
  emptyLabel = "بدون داده",
  href,
}: {
  title: string;
  label: string;
  percentage: number | null;
  detail: string;
  emptyLabel?: string;
  href?: string;
}) {
  const titleId = useId();
  const safePercentage =
    percentage === null ? 0 : Math.min(100, Math.max(0, percentage));
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - safePercentage / 100);
  const content = (
    <>
      <h2
        id={titleId}
        className="text-lg font-black text-[var(--sds-text-primary)] sm:text-xl"
      >
        {title}
      </h2>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4 sm:flex-row sm:gap-8">
        <div
          role="img"
          aria-label={
            percentage === null
              ? `${label}: ${emptyLabel}`
              : `${label}: ${safePercentage.toLocaleString("fa-IR")} درصد`
          }
          className="relative h-36 w-36 shrink-0"
        >
          <svg
            viewBox="0 0 128 128"
            className="h-full w-full -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              stroke="var(--sds-surface-subtle)"
              strokeWidth="10"
            />
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              stroke="var(--sds-accent)"
              strokeLinecap="round"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-3xl font-black tabular-nums text-[var(--sds-text-primary)]">
            {percentage === null
              ? "—"
              : `${safePercentage.toLocaleString("fa-IR")}٪`}
          </span>
        </div>
        <div className="text-center sm:text-right">
          <p className="text-lg font-black text-[var(--sds-text-primary)]">
            {label}
          </p>
          <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
            {detail}
          </p>
        </div>
      </div>
    </>
  );
  return href ? (
    <Link
      href={href}
      aria-labelledby={titleId}
      className="sds-neumorphic-card sds-neumorphic-interactive flex h-full min-h-[22rem] flex-col p-4 outline-none sm:p-5"
    >
      {content}
    </Link>
  ) : (
    <ErpNeumorphicCard className="flex h-full min-h-[22rem] flex-col p-4 sm:p-5">
      {content}
    </ErpNeumorphicCard>
  );
}

export interface ErpMobileNavigationItem {
  id: string;
  label: string;
  href: string;
  activePath?: string;
  icon: IconType;
  exact?: boolean;
}

export function ErpMobileBottomNavigation({
  items,
  ariaLabel,
}: {
  items: ErpMobileNavigationItem[];
  ariaLabel: string;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={ariaLabel}
      className="sds-neumorphic-bottom-nav fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-30 grid grid-cols-5 p-1.5 lg:hidden"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const activePath = item.activePath ?? item.href;
        const active = item.exact
          ? pathname === activePath
          : pathname.startsWith(activePath);
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]",
              active
                ? "bg-[var(--sds-accent-soft)] text-[var(--sds-accent-on-soft)] shadow-[var(--sds-neu-shadow-inset)]"
                : "text-[var(--sds-text-secondary)] hover:text-[var(--sds-accent)]",
            )}
          >
            <Icon className="h-6 w-6" />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
