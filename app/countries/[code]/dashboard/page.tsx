import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function DashboardPage({
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

  // Get latest calculation
  const { data: latestCalculation } = await supabase
    .from('severity_calculations')
    .select('*, pin_results(*)')
    .eq('country_id', country.id)
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  // Get summary statistics
  let totalPin = 0
  const severityCounts: Record<string, number> = {
    critical: 0,
    severe: 0,
    moderate: 0,
    minimal: 0,
  }

  if (latestCalculation?.pin_results) {
    const results = latestCalculation.pin_results as any[]
    results.forEach((result: any) => {
      if (result.pin_count) {
        totalPin += result.pin_count
      }
      if (result.severity_level) {
        severityCounts[result.severity_level] =
          (severityCounts[result.severity_level] || 0) + 1
      }
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link
              href={`/countries/${code}`}
              className="text-sm font-semibold text-gray-900"
            >
              ← {country.name}
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">Dashboard</h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xs text-gray-600">Total PIN</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalPin.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs text-gray-600">Critical</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {severityCounts.critical}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs text-gray-600">Severe</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {severityCounts.severe}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xs text-gray-600">Moderate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {severityCounts.moderate}
              </div>
            </CardContent>
          </Card>
        </div>

        {latestCalculation ? (
          <Card>
            <CardHeader>
              <CardTitle>Latest Calculation Results</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-600 mb-4">
                Calculated on {new Date(latestCalculation.created_at).toLocaleString()}
              </p>
              <div className="text-xs text-gray-600 mb-4">
                Map visualization and detailed results coming soon
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-gray-600 mb-4">
                No calculations completed yet
              </p>
              <Link href={`/countries/${code}/calculations`}>
                <span className="text-xs text-blue-600 hover:underline">
                  Run a calculation →
                </span>
              </Link>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}

