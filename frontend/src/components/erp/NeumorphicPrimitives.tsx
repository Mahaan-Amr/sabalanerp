"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type DetailsHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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

export const ErpNeumorphicInteractiveCard = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function ErpNeumorphicInteractiveCard({ className, type = "button", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={cx(
        "sds-action sds-neumorphic-card sds-neumorphic-interactive",
        className,
      )}
    />
  );
});

export function ErpNeumorphicDialog({
  open,
  onClose,
  labelledBy,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const selector =
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      const firstFocusable = dialog?.querySelector<HTMLElement>(selector);
      if (firstFocusable) firstFocusable.focus();
      else dialog?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(selector) ?? [],
      );
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "Tab" && focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.key === "Tab") {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!mounted) return null;
  const dialog = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--sds-surface-overlay)] p-3"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx(
          "sds-neumorphic-card max-h-[calc(100dvh-1.5rem)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
  return createPortal(open ? dialog : null, document.body);
}

export function ErpNeumorphicDisclosure({
  className,
  ...props
}: DetailsHTMLAttributes<HTMLDetailsElement>) {
  return (
    <details
      {...props}
      className={cx("sds-neumorphic-card", className)}
    />
  );
}

export function ErpNeumorphicSelectedSummary({
  icon: Icon,
  label,
  title,
  children,
  className,
}: {
  icon: IconType;
  label: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <ErpNeumorphicCard
      className={cx(
        "border-[var(--sds-accent)] bg-[var(--sds-accent-soft)] p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="sds-neumorphic-icon inline-flex h-10 w-10 flex-shrink-0 items-center justify-center bg-[var(--sds-accent-soft)] text-[var(--sds-accent-on-soft)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[var(--sds-accent)]">{label}</p>
          <h4 className="mt-1 break-words text-base font-semibold text-[var(--sds-text-primary)]">
            {title}
          </h4>
          {children}
        </div>
      </div>
    </ErpNeumorphicCard>
  );
}

export interface ErpNeumorphicMetric {
  id: string;
  label: string;
  value: ReactNode;
  icon: IconType;
  tone?: ErpTone;
  href?: string;
  hint?: ReactNode;
}

export function ErpNeumorphicMetricGrid({
  items,
  label = "شاخص‌های کلیدی",
  columns = 4,
  mobileColumns = 2,
}: {
  items: ErpNeumorphicMetric[];
  label?: string;
  columns?: 2 | 3 | 4;
  mobileColumns?: 1 | 2;
}) {
  return (
    <section
      aria-label={label}
      className={cx(
        "grid gap-3 xl:gap-4",
        mobileColumns === 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2",
        columns === 2 && "xl:grid-cols-2",
        columns === 3 && "xl:grid-cols-3",
        columns === 4 && "xl:grid-cols-4",
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const tone = item.tone || "primary";
        const content = (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-5 text-[var(--sds-text-secondary)] sm:text-sm">
                {item.label}
              </p>
              <p className="mt-1 break-words text-[clamp(1.25rem,2vw,1.875rem)] font-black leading-tight tabular-nums text-[var(--sds-text-primary)] [overflow-wrap:anywhere]">
                {item.value}
              </p>
              {item.hint && (
                <p className="mt-1 text-xs text-[var(--sds-text-muted)]">{item.hint}</p>
              )}
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
            className="sds-neumorphic-card sds-neumorphic-interactive flex min-h-24 items-center justify-between gap-3 p-4 outline-none"
          >
            {content}
          </Link>
        ) : (
          <ErpNeumorphicCard
            key={item.id}
            as="article"
            className="flex min-h-24 items-center justify-between gap-3 p-4"
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
  showTitle = true,
}: {
  title: string;
  items: ErpNeumorphicActionItem[];
  desktopColumns?: 4 | 5;
  showTitle?: boolean;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <h2
        id={titleId}
        className={cx(
          showTitle
            ? "text-lg font-black text-[var(--sds-text-primary)] sm:text-xl"
            : "sr-only",
        )}
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
              className="sds-neumorphic-card sds-neumorphic-interactive group flex min-h-24 flex-col items-center justify-center gap-2.5 p-4 text-center outline-none"
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
  size = "default",
}: {
  title: string;
  label: string;
  percentage: number | null;
  detail: string;
  emptyLabel?: string;
  href?: string;
  size?: "default" | "compact";
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
          className={size === "compact" ? "relative h-20 w-20 shrink-0 lg:h-24 lg:w-24" : "relative h-36 w-36 shrink-0"}
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
          <span className={`absolute inset-0 flex items-center justify-center font-black tabular-nums text-[var(--sds-text-primary)] ${size === "compact" ? "text-xl" : "text-3xl"}`}>
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
              "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-bold outline-none transition-colors motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]",
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
