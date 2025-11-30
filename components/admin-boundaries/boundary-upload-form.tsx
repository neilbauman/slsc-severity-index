'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface BoundaryUploadFormProps {
  countryId: string
  countryCode: string
  config: any
}

export function BoundaryUploadForm({ countryId, countryCode, config }: BoundaryUploadFormProps) {
  const router = useRouter()
  const [uploadMethod, setUploadMethod] = useState<'hdx' | 'file'>('file')
  const [hdxUrl, setHdxUrl] = useState('https://data.humdata.org/dataset/cod-ab-phl')
  const [file, setFile] = useState<File | null>(null)
  const [processAllLevels, setProcessAllLevels] = useState(true)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.0001)
  const [autoDetect, setAutoDetect] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')

  const adminLevels = config?.adminLevels || []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setProgress('')

    if (uploadMethod === 'hdx' && !hdxUrl) {
      setError('Please provide an HDX dataset URL')
      return
    }

    if (uploadMethod === 'file' && !file) {
      setError('Please select a file')
      return
    }

    setLoading(true)

    try {
      const formData = new FormData()
      formData.append('countryId', countryId)
      formData.append('processAllLevels', processAllLevels.toString())
      formData.append('autoDetect', autoDetect.toString())
      formData.append('simplifyTolerance', simplifyTolerance.toString())
      
      if (uploadMethod === 'hdx') {
        formData.append('hdxUrl', hdxUrl)
        setProgress('Fetching data from HDX...')
      } else {
        formData.append('file', file!)
        setProgress('Processing COD file and detecting all admin levels...')
      }

      const response = await fetch('/api/admin-boundaries/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      const summary = data.summary || {}
      const totalCount = Object.values(summary).reduce((sum: number, count: any) => sum + count, 0)
      setProgress(`Successfully imported ${totalCount} boundaries across ${Object.keys(summary).length} admin levels!`)
      setTimeout(() => {
        router.push(`/countries/${countryCode}/admin-boundaries`)
        router.refresh()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Upload Method</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="method"
                value="hdx"
                checked={uploadMethod === 'hdx'}
                onChange={(e) => setUploadMethod(e.target.value as 'hdx')}
              />
              <span className="text-sm">From HDX Dataset</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="method"
                value="file"
                checked={uploadMethod === 'file'}
                onChange={(e) => setUploadMethod(e.target.value as 'file')}
              />
              <span className="text-sm">Upload File</span>
            </label>
          </div>

          {uploadMethod === 'hdx' ? (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                HDX Dataset URL
              </label>
              <Input
                value={hdxUrl}
                onChange={(e) => setHdxUrl(e.target.value)}
                placeholder="https://data.humdata.org/dataset/..."
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Example: https://data.humdata.org/dataset/cod-ab-phl
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                GeoJSON or Shapefile
              </label>
              <Input
                type="file"
                accept=".geojson,.json,.zip,.shp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required={uploadMethod === 'file'}
              />
              <p className="text-xs text-gray-500 mt-1">
                Supported: GeoJSON (.geojson, .json) or Shapefile (.zip with .shp)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Processing Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="processAllLevels"
              checked={processAllLevels}
              onChange={(e) => setProcessAllLevels(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="processAllLevels" className="text-xs text-gray-700">
              Process all admin levels from COD file (recommended)
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoDetect"
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
              className="h-4 w-4"
              disabled={!processAllLevels}
            />
            <label htmlFor="autoDetect" className="text-xs text-gray-700">
              Auto-detect field names (ADM0_EN, ADM1_EN, etc.)
            </label>
          </div>

          <div className="bg-blue-50 p-3 rounded text-xs text-gray-700">
            <strong>How it works:</strong> The system will automatically detect all admin levels
            in your COD file (Adm0, Adm1, Adm2, etc.) and import them all at once, automatically
            building the parent-child hierarchy.
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Simplification Tolerance
            </label>
            <Input
              type="number"
              step="0.0001"
              min="0"
              max="1"
              value={simplifyTolerance}
              onChange={(e) => setSimplifyTolerance(Number(e.target.value))}
              size="sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Higher values = simpler geometries (default: 0.0001). Increase if boundaries are too complex.
            </p>
          </div>
        </CardContent>
      </Card>

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
          {loading ? 'Processing...' : 'Upload & Process'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

