import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function CalculationsPage({
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

  const { data: calculations } = await supabase
    .from('severity_calculations')
    .select('*')
    .eq('country_id', country.id)
    .order('created_at', { ascending: false })

  const {
    data: { user },
  } = await supabase.auth.getUser()

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
            <h1 className="text-lg font-semibold text-gray-900">
              Severity Calculations
            </h1>
            {user && (
              <Link href={`/countries/${code}/calculations/new`}>
                <Button size="sm">Run Calculation</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Calculation History</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-4">
              Run severity calculations using baseline datasets and hazards to determine
              People in Need (PIN) by administrative unit.
            </p>
            {calculations && calculations.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calculations.map((calc: any) => (
                    <TableRow key={calc.id}>
                      <TableCell className="text-xs text-gray-600">
                        {new Date(calc.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            calc.status === 'complete'
                              ? 'status-success'
                              : calc.status === 'error'
                              ? 'status-error'
                              : 'status-info'
                          }
                        >
                          {calc.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {(calc.model_config as any)?.model || '—'}
                      </TableCell>
                      <TableCell>
                        {calc.status === 'complete' && (
                          <Link href={`/countries/${code}/calculations/${calc.id}`}>
                            <Button variant="ghost" size="sm">View</Button>
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600 mb-4">
                  No calculations run yet
                </p>
                {user && (
                  <Link href={`/countries/${code}/calculations/new`}>
                    <Button size="sm">Run First Calculation</Button>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

