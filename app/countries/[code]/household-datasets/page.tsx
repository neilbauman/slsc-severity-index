'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'

export default function HouseholdDatasetsPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const [datasets, setDatasets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [countryId, setCountryId] = useState<string | null>(null)

  useEffect(() => {
    loadCountryAndDatasets()
  }, [code])

  async function loadCountryAndDatasets() {
    try {
      // Get country ID first
      const countryResponse = await fetch(`/api/countries?code=${code.toUpperCase()}`)
      if (countryResponse.ok) {
        const countryData = await countryResponse.json()
        if (countryData.countries && countryData.countries.length > 0) {
          const country = countryData.countries[0]
          setCountryId(country.id)
          loadDatasets(country.id)
        }
      }
    } catch (error) {
      console.error('Error loading country:', error)
      setLoading(false)
    }
  }

  async function loadDatasets(countryId: string) {
    try {
      const response = await fetch(`/api/datasets/household?country_id=${countryId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.datasets) {
          setDatasets(data.datasets)
        }
      }
    } catch (error) {
      console.error('Error loading datasets:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!countryId) {
      alert('Country not loaded')
      return
    }

    setUploading(true)

    try {
      const formData = new FormData(event.currentTarget)
      formData.append('country_id', countryId)

      const response = await fetch('/api/datasets/household/upload', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()

      if (!response.ok) {
        alert(`Error: ${result.error}`)
        return
      }

      alert('Household dataset uploaded successfully!')
      setShowUploadForm(false)
      loadDatasets(countryId)
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
              Household Datasets
            </h1>
            {!showUploadForm && (
              <Button size="sm" onClick={() => setShowUploadForm(true)}>
                Upload Dataset
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {showUploadForm && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Upload Household Dataset</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
                <strong>💡 What is this?</strong> This is your household survey data. From your Excel file, 
                extract the "HH dataset" sheet (the one with all the household survey responses). 
                <strong>Important:</strong> Make sure it has pcode columns (like "Admin1 P-Code" or "Admin2 P-Code") 
                so households can be linked to administrative boundaries.
              </div>
              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Dataset File *</label>
                  <Input
                    type="file"
                    name="file"
                    accept=".xlsx,.xls,.csv"
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Upload household-level survey data (Excel or CSV). This should be the "HH dataset" sheet 
                    from your calculation template Excel file, exported as a separate file.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <Input type="text" name="name" required placeholder="Dataset name" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description (optional)</label>
                  <Input type="text" name="description" placeholder="Dataset description" />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={uploading || !countryId}>
                    {uploading ? 'Uploading...' : 'Upload Dataset'}
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
            <CardTitle>Household Datasets</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-4">
              Upload household-level survey datasets for severity calculations. Datasets should
              include pcode fields to link to administrative boundaries.
            </p>
            {loading ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600">Loading...</p>
              </div>
            ) : datasets && datasets.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Households</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.map((dataset: any) => (
                    <TableRow key={dataset.id}>
                      <TableCell className="font-medium">{dataset.name}</TableCell>
                      <TableCell>{dataset.total_households || 0}</TableCell>
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
                        {new Date(dataset.created_at).toLocaleDateString()}
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
                  No household datasets uploaded yet
                </p>
                <Button size="sm" onClick={() => setShowUploadForm(true)}>
                  Upload First Dataset
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

