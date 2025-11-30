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
  const [uploadMethod, setUploadMethod] = useState<'hdx' | 'file'>('hdx')
  const [hdxUrl, setHdxUrl] = useState('https://data.humdata.org/dataset/cod-ab-phl')
  const [file, setFile] = useState<File | null>(null)
  const [level, setLevel] = useState<number>(1)
  const [nameField, setNameField] = useState('ADM1_EN')
  const [pcodeField, setPcodeField] = useState('ADM1_PCODE')
  const [parentField, setParentField] = useState('')
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.0001)
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
      formData.append('level', level.toString())
      formData.append('nameField', nameField)
      formData.append('pcodeField', pcodeField)
      formData.append('simplifyTolerance', simplifyTolerance.toString())
      
      if (uploadMethod === 'hdx') {
        formData.append('hdxUrl', hdxUrl)
        setProgress('Fetching data from HDX...')
      } else {
        formData.append('file', file!)
        setProgress('Uploading file...')
      }

      if (parentField) {
        formData.append('parentField', parentField)
      }

      const response = await fetch('/api/admin-boundaries/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      setProgress(`Successfully imported ${data.count} boundaries!`)
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
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Administrative Level
            </label>
            <select
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="w-full h-8 px-2 text-xs border border-gray-300 rounded"
            >
              {adminLevels.map((levelConfig: any) => (
                <option key={levelConfig.level} value={levelConfig.level}>
                  Adm{levelConfig.level} - {levelConfig.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Name Field
              </label>
              <Input
                value={nameField}
                onChange={(e) => setNameField(e.target.value)}
                placeholder="ADM1_EN"
                size="sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Pcode Field
              </label>
              <Input
                value={pcodeField}
                onChange={(e) => setPcodeField(e.target.value)}
                placeholder="ADM1_PCODE"
                size="sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Parent Field (optional)
            </label>
            <Input
              value={parentField}
              onChange={(e) => setParentField(e.target.value)}
              placeholder="ADM0_PCODE"
              size="sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Field that contains the parent boundary Pcode for hierarchy
            </p>
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

