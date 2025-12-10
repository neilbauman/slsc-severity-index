'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'

export default function UploadHazardPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string

  const [hazardName, setHazardName] = useState('')
  const [hazardType, setHazardType] = useState('flood')
  const [hazardDate, setHazardDate] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [useUrl, setUseUrl] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null
    setFile(selectedFile)
    if (selectedFile && !hazardName) {
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, '')
      setHazardName(nameWithoutExt)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setProgress('')

    if (!hazardName.trim()) {
      setError('Please enter a hazard name')
      return
    }

    if (!useUrl && !file) {
      setError('Please select a file or enter a URL')
      return
    }

    if (useUrl && !sourceUrl.trim()) {
      setError('Please enter a URL')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      // Check if user is authenticated
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        throw new Error('You must be logged in to upload files')
      }

      // Get country ID
      const { data: country } = await supabase
        .from('countries')
        .select('id')
        .eq('code', code.toUpperCase())
        .single()

      if (!country) {
        throw new Error('Country not found')
      }

      let filePath: string | null = null

      if (file) {
        // Upload file to Supabase Storage
        setProgress('Uploading file to storage...')
        const timestamp = Date.now()
        const fileName = `${code}-${timestamp}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const path = `${code}/hazards/${fileName}`

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('admin-boundaries') // Using same bucket, could create a hazards bucket later
          .upload(path, file, {
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          const errorMessage = uploadError.message || String(uploadError)
          throw new Error(`Failed to upload file: ${errorMessage}`)
        }

        filePath = path
      }

      setProgress('Processing hazard data...')

      // Create hazard via API
      const createResponse = await fetch('/api/hazards/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryId: country.id,
          name: hazardName,
          type: hazardType,
          date: hazardDate || null,
          filePath: filePath,
          sourceUrl: useUrl ? sourceUrl : null,
        }),
      })

      let createData: any
      try {
        const text = await createResponse.text()
        if (!text) {
          throw new Error('Empty response from server')
        }
        createData = JSON.parse(text)
      } catch (parseError: any) {
        // If response is not JSON, it might be an HTML error page or plain text
        throw new Error(
          `Server error: Failed to parse response. ` +
          `This might indicate the file format is invalid or the server encountered an error. ` +
          `Please check that your shapefile contains .shp and .dbf files.`
        )
      }

      if (!createResponse.ok) {
        throw new Error(createData.error || 'Failed to upload hazard')
      }

      setProgress('Hazard uploaded successfully!')

      // Redirect to hazards page
      setTimeout(() => {
        router.push(`/countries/${code}/hazards`)
      }, 1000)
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
              Upload Hazard
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Upload Hazard Data</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Hazard Name *
                </label>
                <Input
                  value={hazardName}
                  onChange={(e) => setHazardName(e.target.value)}
                  placeholder="e.g., Flood Monitoring - November 2025"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Hazard Type *
                </label>
                <select
                  value={hazardType}
                  onChange={(e) => setHazardType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                  required
                >
                  <option value="flood">Flood</option>
                  <option value="earthquake">Earthquake</option>
                  <option value="cyclone">Cyclone</option>
                  <option value="drought">Drought</option>
                  <option value="conflict">Conflict</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Hazard Date
                </label>
                <Input
                  type="date"
                  value={hazardDate}
                  onChange={(e) => setHazardDate(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Date when the hazard occurred or was observed
                </p>
              </div>

              <div className="border-t pt-4">
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={useUrl}
                    onChange={(e) => setUseUrl(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Download from URL (e.g., UNOSAT)
                  </span>
                </label>

                {useUrl ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Source URL *
                    </label>
                    <Input
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://unosat.org/.../FL20251128LKA_SHP.zip"
                      required={useUrl}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      URL to download the hazard data (zip file containing shapefiles or GeoJSON)
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      File (GeoJSON, Shapefile ZIP) *
                    </label>
                    <Input
                      type="file"
                      accept=".geojson,.json,.zip"
                      onChange={handleFileSelect}
                      required={!useUrl}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Supported formats: GeoJSON (.geojson, .json), Shapefile (.zip containing .shp, .dbf files)
                    </p>
                  </div>
                )}
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
                  {loading ? 'Uploading...' : 'Upload Hazard'}
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

        <Card className="mt-6 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-sm">💡 About Hazard Uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-2 text-gray-700">
              <p>
                <strong>Shapefiles:</strong> Upload a ZIP file containing .shp, .dbf, and optionally .prj files. 
                The system will automatically convert them to GeoJSON for storage and analysis.
              </p>
              <p>
                <strong>URL Downloads:</strong> You can paste a direct download URL (e.g., from UNOSAT) 
                and the system will download and process the file automatically.
              </p>
              <p>
                <strong>Spatial Analysis:</strong> Once uploaded, hazard data can be analyzed to find 
                overlaps with populated areas and administrative boundaries for impact assessment.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

