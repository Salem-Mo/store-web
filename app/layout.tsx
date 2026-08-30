import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'سوبر ماركت أيوب - للنظم الذكية',
    template: '%s | سوبر ماركت أيوب',
  },
  description: 'نظام إدارة المبيعات والمخزون والمصروفات لسوبر ماركت أيوب — نقطة بيع، إدارة مخزون، تقفيل شيفت وواتساب',
  applicationName: 'سوبر ماركت أيوب',
  referrer: 'strict-origin-when-cross-origin',
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl" className="bg-background" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
