'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { FaCheck, FaFileContract, FaGem, FaTruck, FaUsers } from 'react-icons/fa';

const workflow = [
  { label: 'CRM', icon: FaUsers, text: 'پرونده مشتری' },
  { label: 'Contract', icon: FaFileContract, text: 'قرارداد فروش' },
  { label: 'Stone', icon: FaGem, text: 'کاتالوگ سنگ' },
  { label: 'Delivery', icon: FaTruck, text: 'تحویل و پرداخت' },
];

export function PublicHeroVisual() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className="public-hero-visual"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 24, rotateX: 8 }}
      animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
    >
      <div className="public-visual-topbar">
        <span />
        <span />
        <span />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <div className="public-visual-panel">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-teal-700">جریان قرارداد</p>
              <h3 className="mt-1 text-xl font-extrabold text-stone-950">از مشتری تا تحویل</h3>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">فعال</span>
          </div>

          <div className="relative space-y-3">
            <div className="absolute right-5 top-6 h-[calc(100%-48px)] w-px bg-stone-200" />
            {workflow.map((item, index) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.label}
                  className="relative flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-3 shadow-sm"
                  animate={shouldReduceMotion ? undefined : { y: [0, -4, 0] }}
                  transition={{ duration: 4, delay: index * 0.35, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <span className="z-10 flex h-10 w-10 items-center justify-center rounded-lg bg-stone-950 text-white">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-stone-950">{item.text}</p>
                    <p className="text-xs text-stone-500">مرحله {index + 1} از عملیات فروش</p>
                  </div>
                  <FaCheck className="h-4 w-4 text-teal-600" />
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="public-visual-panel">
            <p className="text-xs font-semibold text-stone-500">نمای سنگ و برش</p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {Array.from({ length: 12 }).map((_, index) => (
                <motion.span
                  key={index}
                  className="h-12 rounded-md border border-stone-300 bg-[linear-gradient(135deg,#fafaf9,#d6d3d1_45%,#f5f5f4)]"
                  animate={shouldReduceMotion ? undefined : { opacity: [0.65, 1, 0.65] }}
                  transition={{ duration: 3.5, delay: index * 0.08, repeat: Infinity, ease: 'easeInOut' }}
                />
              ))}
            </div>
          </div>

          <div className="public-visual-panel">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold text-stone-950">وضعیت عملیاتی</span>
              <span className="font-bold text-teal-700">قابل پیگیری</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100">
              <motion.div
                className="h-full rounded-full bg-teal-600"
                initial={shouldReduceMotion ? false : { width: '28%' }}
                animate={shouldReduceMotion ? undefined : { width: ['28%', '76%', '58%'] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
