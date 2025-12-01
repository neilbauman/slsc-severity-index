import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DeleteDatasetButton } from '@/components/datasets/delete-dataset-button'

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

  const { data: datasets, error: datasetsError } = await supabase
    .from('datasets')
    .select('*, dataset_types(name)')
    .eq('country_id', country.id)
    .order('uploaded_at', { ascending: false })

  // Log error if query fails (for debugging)
  if (datasetsError) {
    console.error('Error fetching datasets:', datasetsError)
  }

  // Deduplicate: Keep only the most recent dataset for each unique name
  const uniqueDatasets = datasets ? (() => {
    const seen = new Map<string, any>()
    datasets.forEach((dataset: any) => {
      const key = dataset.name.toLowerCase()
      if (!seen.has(key) || new Date(dataset.uploaded_at) > new Date(seen.get(key)!.uploaded_at)) {
        seen.set(key, dataset)
      }
    })
    return Array.from(seen.values()).sort((a, b) => 
      new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
    )
  })() : []

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
              {datasetsError && (
                <div className="text-xs text-red-600 bg-red-50 p-3 rounded mb-4">
                  Error loading datasets: {datasetsError.message}
                  {datasetsError.message.includes('row-level security') && (
                    <div className="mt-2">
                      Please apply the RLS policies migration: migrations/add_datasets_rls_policies.sql
                    </div>
                  )}
                </div>
              )}
              {uniqueDatasets && uniqueDatasets.length > 0 ? (
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
                    {uniqueDatasets.map((dataset: any) => (
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
                            <div className="flex gap-2 items-center">
                              <Link href={`/countries/${code}/core-datasets/${dataset.id}/clean`}>
                                <Button size="sm" variant="secondary">Clean</Button>
                              </Link>
                              <DeleteDatasetButton 
                                datasetId={dataset.id} 
                                datasetName={dataset.name}
                              />
                            </div>
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

