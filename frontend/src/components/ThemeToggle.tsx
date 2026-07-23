'use client';

import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { FaSun, FaMoon } from 'react-icons/fa';

export const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle animate-theme-transition"
      aria-label={theme === 'dark' ? 'فعال‌کردن حالت روشن' : 'فعال‌کردن حالت تیره'}
    >
      {theme === 'dark' ? (
        <FaSun className="w-5 h-5 text-gold-500" />
      ) : (
        <FaMoon className="w-5 h-5 text-teal-500" />
      )}
    </button>
  );
};
