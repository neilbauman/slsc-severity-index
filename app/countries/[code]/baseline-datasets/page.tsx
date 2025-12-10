import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default async function BaselineDatasetsPage({
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
    .select('*, dataset_types(name, badge_color)')
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
              Baseline Datasets
            </h1>
            {user && (
              <Link href={`/countries/${code}/baseline-datasets/upload`}>
                <Button size="sm">Upload Dataset</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Baseline Datasets</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-4">
              Upload and clean baseline/pre-disaster datasets. Data will be validated,
              cleaned, and matched to administrative boundaries.
            </p>
            {datasets && datasets.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Admin Level</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uploaded</TableHead>
                    {user && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.map((dataset: any) => {
                    const metadata = (dataset.metadata as any) || {}
                    const adminLevel = metadata.adminLevel !== null && metadata.adminLevel !== undefined
                      ? metadata.adminLevel
                      : null
                    return (
                      <TableRow key={dataset.id}>
                        <TableCell className="font-medium">{dataset.name}</TableCell>
                        <TableCell>
                          {adminLevel !== null ? (
                            <Badge variant="secondary">ADM{adminLevel}</Badge>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {dataset.dataset_types?.name ? (
                            <Badge
                              variant="custom"
                              style={{
                                backgroundColor: dataset.dataset_types.badge_color || '#gray',
                                color: '#fff',
                              }}
                            >
                              {dataset.dataset_types.name}
                            </Badge>
                          ) : (
                            '—'
                          )}
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
                          {new Date(dataset.uploaded_at).toLocaleDateString()}
                        </TableCell>
                        {user && (
                          <TableCell>
                            <div className="flex gap-2 items-center">
                              <Link href={`/countries/${code}/baseline-datasets/${dataset.id}`}>
                                <Button size="sm" variant="outline">View</Button>
                              </Link>
                              {dataset.status === 'complete' && (
                                <Link href={`/countries/${code}/baseline-datasets/${dataset.id}/clean`}>
                                  <Button size="sm" variant="secondary">Clean</Button>
                                </Link>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600 mb-4">
                  No baseline datasets uploaded yet
                </p>
                {user && (
                  <Link href={`/countries/${code}/baseline-datasets/upload`}>
                    <Button size="sm">Upload Baseline Dataset</Button>
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

