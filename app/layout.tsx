import type { Metadata } from 'next'
import './globals.css'
import { Nav } from './components/Nav'

export const metadata: Metadata = {
  title: 'Deadly Sins — Coaching Dashboard',
  description: 'Pre-match energy status and lineup recommendations',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gray-950 text-gray-100">
        <Nav />
        <main>{children}</main>
      </body>
    </html>
  )
}
