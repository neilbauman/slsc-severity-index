import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function CoreDatasetsPage({
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

  const { data: datasets } = await supabase
    .from('datasets')
    .select('*, dataset_types(name)')
    .eq('country_id', country.id)
    .order('uploaded_at', { ascending: false })

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
              Core Datasets
            </h1>
            {user && (
              <Link href={`/countries/${code}/core-datasets/upload`}>
                <Button size="sm">Upload Dataset</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Population Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-600 mb-4">
                Upload population datasets (CSV, Excel, GeoJSON) with Pcode matching
              </p>
              {user && (
                <Link href={`/countries/${code}/core-datasets/upload`}>
                  <Button size="sm">Upload Population Data</Button>
                </Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Datasets</CardTitle>
            </CardHeader>
            <CardContent>
              {datasets && datasets.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Uploaded</TableHead>
                      {user && <TableHead>Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {datasets.map((dataset: any) => (
                      <TableRow key={dataset.id}>
                        <TableCell className="font-medium">{dataset.name}</TableCell>
                        <TableCell>
                          {dataset.dataset_types?.name || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              dataset.status === 'complete'
                                ? 'status-success'
                                : dataset.status === 'error'
                                ? 'status-error'
                                : 'status-info'
                            }
                          >
                            {dataset.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">
                          {dataset.version || '—'}
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">
                          {new Date(dataset.uploaded_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {user && (
                            <Link href={`/countries/${code}/core-datasets/${dataset.id}/clean`}>
                              <Button size="sm" variant="secondary">Clean</Button>
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-600">
                    No datasets uploaded yet
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

