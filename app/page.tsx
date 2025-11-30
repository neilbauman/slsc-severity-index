import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900">
              SLSC Severity Index
            </h1>
            <nav className="flex items-center gap-4">
              {user ? (
                <>
                  <Link
                    href="/countries"
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    Countries
                  </Link>
                  <Link
                    href="/profile"
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    Profile
                  </Link>
                  <form action="/auth/signout" method="post">
                    <button
                      type="submit"
                      className="text-xs text-gray-600 hover:text-gray-900"
                    >
                      Sign Out
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/signup"
                    className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
                  >
                    Sign Up
                  </Link>
                </>
              )}
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Multi-Country Shelter Severity Classification
          </h2>
          <p className="text-sm text-gray-600 mb-8">
            Manage shelter severity assessments across multiple countries. Upload
            administrative boundaries, baseline datasets, hazards, and calculate
            People in Need (PIN) for disaster response planning.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/countries"
              className="p-4 border border-gray-200 rounded hover:border-blue-500 hover:shadow-sm transition"
            >
              <h3 className="font-semibold text-sm mb-2">View Countries</h3>
              <p className="text-xs text-gray-600">
                Browse and explore country-level assessments
              </p>
            </Link>

            {user && (
              <Link
                href="/countries/new"
                className="p-4 border border-gray-200 rounded hover:border-blue-500 hover:shadow-sm transition"
              >
                <h3 className="font-semibold text-sm mb-2">Add Country</h3>
                <p className="text-xs text-gray-600">
                  Create a new country configuration
                </p>
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
