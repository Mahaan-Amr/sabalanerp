"use client";

import { useState } from "react";
import { ErpBadge, ErpCard, ErpPressable } from "@/components/erp";
import { PERFORMANCE_BADGE_ROADMAP, type PerformanceBadgeSummary } from "./performanceBadgeModel";
import { FloatingPerformanceStone } from "./FloatingPerformanceStone";
import styles from "./FloatingPerformanceStone.module.css";

export function PerformanceBadgeRoadmap({ badge }: { badge: PerformanceBadgeSummary }) {
  const [selected, setSelected] = useState<number | null>(null);
  const current = PERFORMANCE_BADGE_ROADMAP.findIndex(({ code }) => code === badge.levelCode);
  const noOfficialResult = badge.officialResult === false;

  return <section aria-label="مسیر هفت نشان عملکرد" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-bold">مسیر نشان‌ها</p>
      {noOfficialResult && <ErpBadge tone="neutral">بدون نتیجه رسمی</ErpBadge>}
    </div>
    <div className={styles.journey}>
      {PERFORMANCE_BADGE_ROADMAP.map((stage, index) => {
        const isCurrent = index === current;
        return <ErpPressable key={stage.code} onClick={() => setSelected(index)} aria-label={`${stage.labelFa}، ${stage.meaningFa}${isCurrent ? '، نشان فعلی' : ''}`} aria-current={isCurrent ? 'step' : undefined} className={`${styles.milestone} ${current >= 0 && index > current ? styles.upcomingMilestone : ''}`}>
          <FloatingPerformanceStone index={index} current={isCurrent} />
          <span className={styles.milestoneText}><span className="block text-sm font-bold">{stage.labelFa}</span><bdi dir="ltr" className={`${styles.roman} block text-xs font-serif`}>{stage.romanNumeral}</bdi><span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{stage.meaningFa}</span></span>
          {isCurrent && <span className={styles.currentLabel}>نشان فعلی</span>}
        </ErpPressable>;
      })}
    </div>
    {selected !== null && <ErpCard className="p-3" aria-live="polite">
      <p className="text-sm font-bold">{PERFORMANCE_BADGE_ROADMAP[selected].labelFa} · {PERFORMANCE_BADGE_ROADMAP[selected].meaningFa}</p>
      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{selected === current ? noOfficialResult ? "نشان فعلی؛ هنوز نتیجهٔ رسمی ثبت نشده است." : "جایگاه فعلی" : "یکی از نشان‌های مسیر عملکرد"}</p>
    </ErpCard>}
  </section>;
}
