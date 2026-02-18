import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deadly Sins — Coaching Dashboard',
  description: 'Pre-match energy status and lineup recommendations',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100">
        {children}
      </body>
    </html>
  )
}
