import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CountryForm } from '@/components/countries/country-form'

export default async function NewCountryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <a href="/countries" className="text-sm font-semibold text-gray-900">
              ← Back
            </a>
            <h1 className="text-lg font-semibold text-gray-900">New Country</h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <CountryForm />
      </main>
    </div>
  )
}

