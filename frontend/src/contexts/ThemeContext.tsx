'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>('dark'); // Default dark mode
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isApplicantPortal = pathname.startsWith('/apply');
  const preferenceKey = isApplicantPortal ? 'hrApplicantTheme' : 'theme';

  useEffect(() => {
    // Check for saved theme preference or default to dark
    const savedTheme = localStorage.getItem(preferenceKey) as Theme;
    setThemeState(savedTheme || (isApplicantPortal ? 'light' : 'dark'));
    setMounted(true);
  }, [isApplicantPortal, preferenceKey]);

  useEffect(() => {
    if (mounted) {
      // Apply theme to document
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem(preferenceKey, theme);
    }
  }, [theme, mounted, preferenceKey]);

  const toggleTheme = () => {
    setThemeState(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const value: ThemeContextType = {
    theme,
    toggleTheme,
    setTheme,
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
