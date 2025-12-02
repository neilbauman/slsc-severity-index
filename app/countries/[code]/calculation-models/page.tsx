'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'

export default function CalculationModelsPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const [models, setModels] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [countryId, setCountryId] = useState<string | null>(null)

  useEffect(() => {
    loadCountryAndModels()
  }, [code])

  async function loadCountryAndModels() {
    try {
      // Get country ID first
      const countryResponse = await fetch(`/api/countries?code=${code.toUpperCase()}`)
      if (countryResponse.ok) {
        const countryData = await countryResponse.json()
        if (countryData.countries && countryData.countries.length > 0) {
          const country = countryData.countries[0]
          setCountryId(country.id)
          loadModels(country.id)
        }
      }
    } catch (error) {
      console.error('Error loading country:', error)
      setLoading(false)
    }
  }

  async function loadModels(countryId: string) {
    try {
      const response = await fetch(`/api/calculation-models?country_id=${countryId}`)
      const data = await response.json()
      if (data.models) {
        setModels(data.models)
      }
    } catch (error) {
      console.error('Error loading models:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setUploading(true)

    if (!countryId) {
      alert('Country not loaded')
      return
    }

    try {
      const formData = new FormData(event.currentTarget)
      formData.append('country_id', countryId)

      const response = await fetch('/api/calculation-models/import', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        alert(`Error: ${result.error}`)
        return
      }

      alert('Calculation model imported successfully!')
      setShowUploadForm(false)
      loadModels()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setUploading(false)
    }
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
              ← {code.toUpperCase()}
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">
              Calculation Models
            </h1>
            {!showUploadForm && (
              <Button size="sm" onClick={() => setShowUploadForm(true)}>
                Import Model
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {showUploadForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Import Calculation Model from Excel</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Excel File</label>
                  <Input
                    type="file"
                    name="file"
                    accept=".xlsx,.xls"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Upload an SSC calculation template Excel file
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Name (optional)</label>
                  <Input type="text" name="name" placeholder="Auto-detected from file" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Version (optional)</label>
                  <Input type="text" name="version" placeholder="Auto-detected from file" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description (optional)</label>
                  <Input type="text" name="description" placeholder="Model description" />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={uploading}>
                    {uploading ? 'Importing...' : 'Import Model'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowUploadForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Available Calculation Models</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-4">
              Calculation models define the methodology for scoring severity. Import models from
              Excel templates or create them manually.
            </p>
            {loading ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600">Loading...</p>
              </div>
            ) : models && models.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((model: any) => (
                    <TableRow key={model.id}>
                      <TableCell className="font-medium">{model.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{model.version}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={model.is_active ? 'status-success' : 'status-info'}
                        >
                          {model.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {new Date(model.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600 mb-4">
                  No calculation models available yet
                </p>
                <Button size="sm" onClick={() => setShowUploadForm(true)}>
                  Import First Model
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

