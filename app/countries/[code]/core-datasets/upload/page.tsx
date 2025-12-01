'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'

export default function UploadCoreDatasetPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string

  const [file, setFile] = useState<File | null>(null)
  const [datasetName, setDatasetName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setProgress('')

    if (!file) {
      setError('Please select a file')
      return
    }

    if (!datasetName.trim()) {
      setError('Please enter a dataset name')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      
      // Get country ID
      const { data: country } = await supabase
        .from('countries')
        .select('id')
        .eq('code', code.toUpperCase())
        .single()

      if (!country) {
        throw new Error('Country not found')
      }

      // Check if user is authenticated
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        throw new Error('You must be logged in to upload files')
      }

      // Upload file to Supabase Storage
      setProgress('Uploading file to storage...')
      const timestamp = Date.now()
      const fileName = `${code}-${timestamp}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const filePath = `${code}/core-datasets/${fileName}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('datasets')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        // Provide more helpful error messages
        if (uploadError.message.includes('Bucket not found') || uploadError.statusCode === 400) {
          throw new Error(
            'Storage bucket "datasets" not found. Please create it in Supabase Storage or run the migration: migrations/create_datasets_bucket.sql'
          )
        }
        throw new Error(`Failed to upload file: ${uploadError.message}`)
      }

      setProgress('Creating dataset record...')

      // Create dataset record via API (uses service role to bypass RLS)
      const createResponse = await fetch('/api/datasets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryId: country.id,
          datasetName,
          filePath,
        }),
      })

      const createData = await createResponse.json()

      if (!createResponse.ok) {
        throw new Error(createData.error || 'Failed to create dataset record')
      }

      setProgress('Dataset uploaded successfully!')

      setTimeout(() => {
        router.push(`/countries/${code}/core-datasets`)
        router.refresh()
      }, 1500)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.back()}
              className="text-sm font-semibold text-gray-900 hover:underline"
            >
              ← Back
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              Upload Core Dataset
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Upload Population Dataset</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Dataset Name
                </label>
                <Input
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="e.g., Population 2024"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  File (CSV, Excel, GeoJSON)
                </label>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls,.geojson,.json"
                  onChange={(e) => {
                    const selectedFile = e.target.files?.[0] || null
                    setFile(selectedFile)
                    if (selectedFile && !datasetName) {
                      // Auto-fill name from filename
                      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, '')
                      setDatasetName(nameWithoutExt)
                    }
                  }}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Supported formats: CSV, Excel (.xlsx, .xls), GeoJSON (.geojson, .json)
                </p>
              </div>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 p-3 rounded">
                  {error}
                </div>
              )}

              {progress && (
                <div className="text-xs text-blue-600 bg-blue-50 p-3 rounded">
                  {progress}
                </div>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? 'Uploading...' : 'Upload Dataset'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

