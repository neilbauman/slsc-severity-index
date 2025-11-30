import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default async function CountriesPage() {
  const supabase = await createClient()
  const { data: countries } = await supabase
    .from('countries')
    .select('*')
    .order('name', { ascending: true })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-sm font-semibold text-gray-900">
              ← Back
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">Countries</h1>
            {user && (
              <Link href="/countries/new">
                <Button size="sm">Add Country</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {countries && countries.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {countries.map((country) => (
              <Link key={country.id} href={`/countries/${country.code}`}>
                <Card className="hover:border-blue-500 transition cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{country.name}</CardTitle>
                      <Badge variant="secondary">{country.code}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-xs text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Status:</span>
                        <Badge
                          variant={country.is_public ? 'status-success' : 'status-info'}
                        >
                          {country.is_public ? 'Public' : 'Private'}
                        </Badge>
                      </div>
                      <div>
                        <span className="text-gray-500">
                          Created: {new Date(country.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-sm text-gray-600 mb-4">No countries yet</p>
            {user && (
              <Link href="/countries/new">
                <Button>Create First Country</Button>
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

