import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { WorkspaceProvider } from '@/contexts/WorkspaceContext'

export const metadata: Metadata = {
  title: 'Sablan ERP - سیستم برنامه‌ریزی منابع سازمانی',
  description: 'سامانه یکپارچه مدیریت فرایندهای سازمانی سبلان',
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
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="سبلان ERP" />
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

