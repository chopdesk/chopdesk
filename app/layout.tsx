import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import './globals.css'
import PWAInstall from './pwa-install/page'
import { ToastProvider } from '@/lib/toast'
import { brand } from '@/lib/brand'


export const metadata: Metadata = {
  title: brand.name,
  description: 'Restaurant Management System',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: brand.name,
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: brand.themeColor,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="icon" type="image/svg+xml" href={brand.icon} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${GeistSans.variable} font-body`}>
        <ToastProvider>
          {children}
          <PWAInstall />
        </ToastProvider>
      </body>
    </html>
  )
}