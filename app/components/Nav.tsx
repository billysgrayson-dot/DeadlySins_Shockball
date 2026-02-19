import Link from 'next/link'
import { ThemeToggle } from './ThemeToggle'

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/95 backdrop-blur px-4 py-3">
      <div className="mx-auto max-w-7xl flex items-center gap-4">
        {/* Logo */}
        <Link
          href="/dashboard"
          className="shrink-0 text-sm font-bold text-white tracking-tight hover:text-gray-300 transition-colors"
        >
          ☠ Deadly Sins
        </Link>

        {/* Nav links */}
        <div className="hidden sm:flex items-center gap-1 text-sm">
          {[
            { href: '/dashboard',   label: 'Dashboard'    },
            { href: '/leaderboard', label: 'Leaderboard'  },
            { href: '/compare',     label: 'Compare'      },
            { href: '/admin',       label: 'Admin'        },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded px-3 py-1.5 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search */}
        <form method="get" action="/search" className="hidden sm:block">
          <input
            name="q"
            type="search"
            placeholder="Search players…"
            className="w-44 rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:border-gray-500 focus:outline-none transition-colors"
          />
        </form>

        {/* Theme toggle */}
        <ThemeToggle />
      </div>
    </nav>
  )
}
