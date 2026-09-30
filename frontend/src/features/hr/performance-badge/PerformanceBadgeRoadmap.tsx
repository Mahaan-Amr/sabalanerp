"use client";

import Image from "next/image";
import { useState } from "react";
import { ErpBadge, ErpCard, ErpPressable } from "@/components/erp";
import { PERFORMANCE_BADGE_ROADMAP, type PerformanceBadgeSummary } from "./performanceBadgeModel";
import styles from "./PerformanceBadgeRoadmap.module.css";

export function PerformanceBadgeRoadmap({ badge }: { badge: PerformanceBadgeSummary }) {
  const [selected, setSelected] = useState<number | null>(null);
  const current = PERFORMANCE_BADGE_ROADMAP.findIndex(({ code }) => code === badge.levelCode);
  const noOfficialResult = badge.officialResult === false;

  return <section aria-label="مسیر هفت نشان عملکرد" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-bold">مسیر نشان‌ها</p>
      {noOfficialResult && <ErpBadge tone="neutral">بدون نتیجه رسمی</ErpBadge>}
    </div>
    <div className="relative grid gap-2 before:absolute before:bottom-8 before:right-8 before:top-8 before:w-px before:bg-[var(--sds-border-strong)] lg:grid-cols-7 lg:before:bottom-auto lg:before:left-8 lg:before:right-8 lg:before:top-11 lg:before:h-px lg:before:w-auto">
      {PERFORMANCE_BADGE_ROADMAP.map((stage, index) => {
        const isCurrent = index === current;
        return <ErpPressable
          key={stage.code}
          type="button"
          onClick={() => setSelected(index)}
          aria-label={`${stage.labelFa}، ${stage.meaningFa}${isCurrent ? noOfficialResult ? '، نشان فعلی، بدون نتیجه رسمی' : '، جایگاه فعلی' : '، مشاهدهٔ معنا'}`}
          aria-current={isCurrent ? "step" : undefined}
          className={`${styles.mobileStage} ${isCurrent ? styles.mobileCurrent : ""} relative flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border p-2 text-right lg:min-h-44 lg:flex-col lg:justify-start lg:gap-1 lg:px-1 lg:py-2 lg:text-center ${isCurrent ? "border-2 border-[var(--sds-border-strong)] bg-[var(--sds-surface-raised)] shadow-[var(--sds-shadow-raised)]" : "border-[var(--sds-border-default)] bg-[var(--sds-surface-panel)]"}`}
        >
          {isCurrent && <span className="absolute inset-y-2 right-0 w-1 rounded-l-full bg-[var(--sds-accent)] lg:hidden" aria-hidden="true" />}
          <span className="relative block h-14 w-14 shrink-0 lg:h-20 lg:w-20" aria-hidden="true">
            <Image src={`/assets/performance-rank-badges-roman-v1/light/rank-${stage.assetNumber}.png`} alt="" fill sizes="(min-width: 1024px) 80px, 56px" className={`object-contain dark:hidden ${isCurrent ? "" : "grayscale opacity-80"}`} unoptimized />
            <Image src={`/assets/performance-rank-badges-roman-v1/dark/rank-${stage.assetNumber}.png`} alt="" fill sizes="(min-width: 1024px) 80px, 56px" className={`hidden object-contain dark:block ${isCurrent ? "" : "grayscale opacity-80"}`} unoptimized />
          </span>
          <span className="min-w-0 flex-1 lg:flex-none"><span className="block text-sm font-black">{stage.labelFa} <bdi dir="ltr" className="text-xs font-normal">{stage.romanNumeral}</bdi></span><span className="mt-0.5 block text-xs text-[var(--sds-text-secondary)] lg:mt-1">{stage.meaningFa}</span></span>
          {isCurrent && <span className="shrink-0 rounded-full bg-[var(--sds-accent-soft)] px-2 py-1 text-[0.625rem] font-bold text-[var(--sds-accent-on-soft)] lg:mt-auto lg:bg-transparent lg:px-0 lg:py-0 lg:text-xs lg:text-[var(--sds-text-primary)]">{noOfficialResult ? "نشان فعلی" : "جایگاه فعلی"}</span>}
        </ErpPressable>;
      })}
    </div>
    {selected !== null && <ErpCard className="p-3" aria-live="polite">
      <p className="text-sm font-bold">{PERFORMANCE_BADGE_ROADMAP[selected].labelFa} · {PERFORMANCE_BADGE_ROADMAP[selected].meaningFa}</p>
      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{selected === current ? noOfficialResult ? "نشان فعلی؛ هنوز نتیجهٔ رسمی ثبت نشده است." : "جایگاه فعلی" : "یکی از نشان‌های مسیر عملکرد"}</p>
    </ErpCard>}
  </section>;
}
