import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DeleteHazardButton } from '@/components/hazards/delete-hazard-button'

export default async function HazardsPage({
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

  const { data: hazards } = await supabase
    .from('hazards')
    .select('*')
    .eq('country_id', country.id)
    .order('date', { ascending: false })
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
            <h1 className="text-lg font-semibold text-gray-900">Hazards</h1>
            {user && (
              <Link href={`/countries/${code}/hazards/upload`}>
                <Button size="sm">Upload Hazard</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Hazard Data</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-4">
              Upload hazard data (GeoJSON, shapefiles, raster) to identify affected areas
            </p>
            {hazards && hazards.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Uploaded</TableHead>
                    {user && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hazards.map((hazard: any) => (
                    <TableRow key={hazard.id}>
                      <TableCell className="font-medium">{hazard.name}</TableCell>
                      <TableCell>
                        <Badge variant="status-warning">{hazard.type}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {hazard.date ? new Date(hazard.date).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {new Date(hazard.created_at).toLocaleDateString()}
                      </TableCell>
                      {user && (
                        <TableCell>
                          <div className="flex gap-2 items-center">
                            <Link href={`/countries/${code}/hazards/${hazard.id}/impact`}>
                              <Button size="sm" variant="outline">Analyze Impact</Button>
                            </Link>
                            <DeleteHazardButton 
                              hazardId={hazard.id} 
                              hazardName={hazard.name}
                            />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600 mb-4">
                  No hazards uploaded yet
                </p>
                {user && (
                  <Link href={`/countries/${code}/hazards/upload`}>
                    <Button size="sm">Upload Hazard</Button>
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

