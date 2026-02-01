import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { WorkspaceProvider } from '@/contexts/WorkspaceContext'

export const metadata: Metadata = {
  title: 'Sablan ERP - سیستم برنامه ریزی منابع سازمانی',
  description: 'سیستم جامع برنامه ریزی منابع سازمانی با طراحی لوکس و پشتیبانی کامل از زبان فارسی',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#14b8a6" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="سبلان امنیت" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="font-vazir">
        <ThemeProvider>
          <WorkspaceProvider>
            <div className="min-h-screen">
              {children}
            </div>
          </WorkspaceProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
