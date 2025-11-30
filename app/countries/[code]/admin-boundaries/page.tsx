import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function AdminBoundariesPage({
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

  const { data: boundaries } = await supabase
    .from('admin_boundaries')
    .select('*')
    .eq('country_id', country.id)
    .order('level', { ascending: true })
    .order('name', { ascending: true })
    .limit(100)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const config = country.config as any

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
              Admin Boundaries
            </h1>
            {user && (
              <Button size="sm">Upload Boundaries</Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Boundaries</CardTitle>
          </CardHeader>
          <CardContent>
            {boundaries && boundaries.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Level</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Pcode</TableHead>
                    <TableHead>Parent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boundaries.map((boundary) => (
                    <TableRow key={boundary.id}>
                      <TableCell>
                        <Badge variant="secondary">L{boundary.level}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{boundary.name}</TableCell>
                      <TableCell>
                        {boundary.pcode ? (
                          <code className="text-xs">{boundary.pcode}</code>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {boundary.parent_id ? 'Yes' : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600 mb-4">
                  No administrative boundaries uploaded yet
                </p>
                {user && (
                  <Button size="sm">Upload Boundaries</Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

