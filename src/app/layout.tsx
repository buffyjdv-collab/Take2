import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { AppProviders } from '@/components/providers/session-provider'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'QUICK QR — Restaurant Quick-Order SaaS',
  description:
    'Scan-to-order restaurant platform: real-time kitchen display, billing, reports, and QR table ordering.',
  keywords: ['QR ordering', 'restaurant', 'SaaS', 'kitchen display'],
  icons: {
    icon: 'https://z-cdn.chatglm.cn/z-ai/static/logo.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} font-sans antialiased bg-background text-foreground`}
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
