import type { Metadata } from 'next'
import '../styles/design-system-tokens.css'
import '../styles/print.css'
import './globals.css'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { WorkspaceProvider } from '@/contexts/WorkspaceContext'
import { AuthProvider } from '@/contexts/AuthContext'

export const metadata: Metadata = {
  metadataBase: new URL('https://sabalanerp.com'),
  title: 'Sabalan ERP - سیستم برنامه‌ریزی منابع سازمانی',
  description: 'سامانه یکپارچه مدیریت فرایندهای سازمانی سبلان',
  icons: {
    icon: '/brand/logo-project.png',
    shortcut: '/brand/logo-project.png',
    apple: '/brand/logo-project.png',
  },
  openGraph: {
    title: 'Sabalan ERP - سیستم برنامه‌ریزی منابع سازمانی',
    description: 'سامانه یکپارچه مدیریت فرایندهای سازمانی سبلان',
    images: ['/brand/logo-project.png'],
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Sabalan ERP - سیستم برنامه‌ریزی منابع سازمانی',
    description: 'سامانه یکپارچه مدیریت فرایندهای سازمانی سبلان',
    images: ['/brand/logo-project.png'],
  },
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
        <link rel="icon" href="/brand/logo-project.png" />
        <link rel="apple-touch-icon" href="/brand/logo-project.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="سبلان ERP" />
      </head>
      <body className="font-vazir">
        <ThemeProvider>
          <AuthProvider>
            <WorkspaceProvider>
              <div className="min-h-screen">
                {children}
              </div>
            </WorkspaceProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
