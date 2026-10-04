'use client';

import { PERFORMANCE_BADGE_ROADMAP, type PerformanceBadgeSummary } from './performanceBadgeModel';
import styles from './FloatingPerformanceStone.module.css';

const centers = [174, 470, 775, 1085, 1396, 1703, 2008];
export function performanceStoneIndex(badge: PerformanceBadgeSummary) {
  return PERFORMANCE_BADGE_ROADMAP.findIndex(stage => stage.code === badge.levelCode);
}
export function FloatingPerformanceStone({ index, current = false, size = 'roadmap' }: { index: number; current?: boolean; size?: 'header' | 'list' | 'roadmap' }) {
  const height = size === 'header' ? 28 : size === 'list' ? 40 : 64;
  const scale = height / 400;
  const width = height * .66;
  return <span aria-hidden="true" className={`${styles.stoneStage} ${size === 'header' ? styles.headerStone : size === 'list' ? styles.compact : ''} ${current && index >= 0 ? styles.current : ''} ${styles[`gem${index}`] || ''}`}>
    <span className={`${styles.plate} rounded-full shadow-[var(--sds-shadow-card)]`} />
    <span className={`${styles.groundShadow} rounded-full`} />
    {index >= 0 && <span className={styles.stone} style={{ width, height, backgroundImage: 'url(/assets/performance-floating-stones-v1/stones.png)', backgroundSize: `${2172 * scale}px ${724 * scale}px`, backgroundPosition: `${width / 2 - centers[index] * scale}px ${-139 * scale}px` }} />}
  </span>;
}
export function PerformanceBadgeBanner() {
  return <div className={styles.banner} dir="rtl"><div><p className="font-black">سنگ، آدم‌ها را ماندگار می‌کند.</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">هفت نشان · هر سنگ یک معنا</p></div><div className={styles.miniJourney}>{PERFORMANCE_BADGE_ROADMAP.map((stage, index) => <div key={stage.code} className="flex flex-col items-center"><FloatingPerformanceStone index={index} size="list" /><span className={`${styles.bannerName} text-xs font-bold`}>{stage.labelFa}</span><bdi dir="ltr" className={`${styles.roman} text-xs font-serif`}>{stage.romanNumeral}</bdi></div>)}</div></div>;
}
