import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default async function CountryDetailPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const supabase = await createClient()

  const { data: country } = await supabase
    .from('countries')
    .select('*')
    .eq('code', code.toUpperCase())
    .single()

  if (!country) {
    notFound()
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const config = country.config as any

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/countries" className="text-sm font-semibold text-gray-900">
              ← Countries
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">{country.name}</h1>
            <Badge variant="secondary">{country.code}</Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Link href={`/countries/${code}/admin-boundaries`}>
            <Card className="hover:border-blue-500 transition cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">Admin Boundaries</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-600">
                  Manage administrative boundaries and Pcodes
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/countries/${code}/core-datasets`}>
            <Card className="hover:border-blue-500 transition cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">Core Datasets</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-600">
                  Upload population and Pcode data
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/countries/${code}/baseline-datasets`}>
            <Card className="hover:border-blue-500 transition cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">Baseline Datasets</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-600">
                  Upload and clean baseline datasets
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/countries/${code}/hazards`}>
            <Card className="hover:border-blue-500 transition cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">Hazards</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-600">
                  Manage hazard data and affected areas
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/countries/${code}/calculations`}>
            <Card className="hover:border-blue-500 transition cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">Calculations</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-600">
                  Run severity calculations and PIN analysis
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/countries/${code}/dashboard`}>
            <Card className="hover:border-blue-500 transition cursor-pointer">
              <CardHeader>
                <CardTitle className="text-sm">Dashboard</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-gray-600">
                  View severity maps and PIN summaries
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Country Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <span className="text-xs font-medium text-gray-700">Status:</span>
              <Badge
                variant={country.is_public ? 'status-success' : 'status-info'}
                className="ml-2"
              >
                {country.is_public ? 'Public' : 'Private'}
              </Badge>
            </div>

            {config?.adminLevels && (
              <div>
                <span className="text-xs font-medium text-gray-700 block mb-2">
                  Administrative Levels:
                </span>
                <div className="space-y-1">
                  {config.adminLevels.map((level: any, index: number) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-xs text-gray-600"
                    >
                      <Badge variant="secondary">L{level.level}</Badge>
                      <span>{level.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

