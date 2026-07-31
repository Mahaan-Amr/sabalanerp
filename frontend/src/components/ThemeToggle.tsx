'use client';

import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { FaSun, FaMoon } from 'react-icons/fa';
import { ErpPressable } from '@/components/erp';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <ErpPressable
      type="button"
      onClick={toggleTheme}
      variant="ghost"
      className="theme-toggle sds-dashboard-footer-action inline-flex h-12 w-12 items-center justify-center rounded-full p-0"
      aria-label={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تیره'}
    >
      {theme === 'dark' ? (
        <FaSun className="h-5 w-5 text-[var(--sds-warning)]" aria-hidden="true" />
      ) : (
        <FaMoon className="h-5 w-5 text-[var(--sds-accent)]" aria-hidden="true" />
      )}
    </ErpPressable>
  );
};
