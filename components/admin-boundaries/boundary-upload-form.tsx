'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { QualityReport } from './quality-report'

interface BoundaryUploadFormProps {
  countryId: string
  countryCode: string
  config: any
}

export function BoundaryUploadForm({ countryId, countryCode, config }: BoundaryUploadFormProps) {
  const router = useRouter()
  const [uploadMethod, setUploadMethod] = useState<'hdx' | 'file'>('file')
  const [hdxUrl, setHdxUrl] = useState('https://data.humdata.org/dataset/cod-ab-phl')
  const [fileInfo, setFileInfo] = useState<string>('')
  const [file, setFile] = useState<File | null>(null)
  const [processAllLevels, setProcessAllLevels] = useState(true)
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.0001)
  const [autoDetect, setAutoDetect] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')
  const [qualityReport, setQualityReport] = useState<any>(null)

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
    let filePath: string | null = null

    try {
      if (uploadMethod === 'hdx') {
        setProgress('Fetching data from HDX...')
      } else if (file) {
        // Upload file to Supabase Storage first
        setProgress('Uploading file to storage...')
        const supabase = createClient()
        
        // Check if user is authenticated
        const { data: { user: authUser } } = await supabase.auth.getUser()
        if (!authUser) {
          throw new Error('You must be logged in to upload files')
        }
        
        // Generate unique file path
        const timestamp = Date.now()
        const fileName = `${countryCode}-${timestamp}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        filePath = `${countryCode}/${fileName}`

        // Upload to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('admin-boundaries')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
          })

        if (uploadError) {
          console.error('Storage upload error:', uploadError)
          throw new Error(`Failed to upload file to storage: ${uploadError.message}. Please check that the 'admin-boundaries' bucket exists and you have permission to upload.`)
        }

        if (!uploadData) {
          throw new Error('Upload completed but no data returned')
        }

        setProgress('File uploaded successfully. Processing COD file and detecting all admin levels...')
      }

      // Now call the API route with the storage path
      // IMPORTANT: Never send the file directly - always use Supabase Storage for file uploads
      const formData = new FormData()
      formData.append('countryId', countryId)
      formData.append('processAllLevels', processAllLevels.toString())
      formData.append('autoDetect', autoDetect.toString())
      formData.append('simplifyTolerance', simplifyTolerance.toString())
      
      if (uploadMethod === 'hdx') {
        formData.append('hdxUrl', hdxUrl)
      } else if (filePath) {
        formData.append('filePath', filePath)
        // Ensure we never send the file directly in the formData
        // The file should already be in Supabase Storage
      } else {
        throw new Error('No file path available. File upload to storage may have failed.')
      }

      const response = await fetch('/api/admin-boundaries/upload', {
        method: 'POST',
        body: formData,
      })

      // Handle non-JSON responses (like 413 errors)
      let data
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await response.json()
        } catch (parseError) {
          // If JSON parsing fails, check status code
          if (response.status === 413) {
            throw new Error('File is too large. The maximum upload size is 4.5MB on Vercel free tier. Please compress your shapefile or split it into smaller files. You can try using tools like 7-Zip or reducing the geometry complexity.')
          }
          throw new Error('Failed to parse server response')
        }
      } else {
        const text = await response.text()
        if (response.status === 413) {
          throw new Error('File is too large. The maximum upload size is 4.5MB on Vercel free tier. Please compress your shapefile or split it into smaller files. You can try using tools like 7-Zip or reducing the geometry complexity.')
        }
        throw new Error(`Upload failed: ${text || response.statusText}`)
      }

      if (!response.ok) {
        // Show detailed error information if available
        const errorMsg = data.error || 'Upload failed'
        const debugInfo = data.debug ? `\n\nDebug info: ${JSON.stringify(data.debug, null, 2)}` : ''
        throw new Error(errorMsg + debugInfo)
      }

      const summary = data.summary || {}
      const totalCount = Object.values(summary).reduce((sum: number, count: any) => sum + count, 0)
      
      if (totalCount === 0) {
        throw new Error('Upload completed but no boundaries were inserted. Check server logs for details.')
      }
      
      setProgress(`Successfully imported ${totalCount} boundaries across ${Object.keys(summary).length} admin levels!`)
      
      // Store quality report if available
      if (data.qualityReport) {
        setQualityReport(data.qualityReport)
      }
      
      // Clean up: Delete the uploaded file from storage after processing
      if (filePath) {
        try {
          const supabase = createClient()
          const { error: deleteError } = await supabase.storage
            .from('admin-boundaries')
            .remove([filePath])
          
          if (deleteError) {
            console.warn('Failed to cleanup storage file:', deleteError)
          }
        } catch (err) {
          console.warn('Failed to cleanup storage file:', err)
        }
      }
      
      setTimeout(() => {
        router.push(`/countries/${countryCode}/admin-boundaries`)
        router.refresh()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
      setLoading(false)
      
      // Clean up on error too
      if (filePath) {
        try {
          const supabase = createClient()
          const { error: deleteError } = await supabase.storage
            .from('admin-boundaries')
            .remove([filePath])
          
          if (deleteError) {
            console.warn('Failed to cleanup storage file on error:', deleteError)
          }
        } catch (err) {
          console.warn('Failed to cleanup storage file on error:', err)
        }
      }
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
            <label className="flex items-center gap-2 cursor-pointer opacity-50">
              <input
                type="radio"
                name="method"
                value="hdx"
                checked={uploadMethod === 'hdx'}
                onChange={(e) => setUploadMethod(e.target.value as 'hdx')}
                disabled
              />
              <span className="text-sm">From HDX Dataset <span className="text-gray-400">(Coming soon)</span></span>
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
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0] || null
                  setFile(selectedFile)
                  if (selectedFile) {
                    const sizeMB = (selectedFile.size / 1024 / 1024).toFixed(1)
                    const sizeMBNum = parseFloat(sizeMB)
                    setFileInfo(`${selectedFile.name} (${sizeMB} MB)`)
                    if (sizeMBNum > 100) {
                      setError(null) // Clear any previous errors
                      setProgress(`Very large file detected (${sizeMB} MB). Upload and processing may take several minutes...`)
                    } else if (sizeMBNum > 30) {
                      setError(null) // Clear any previous errors
                      setProgress(`Large file detected (${sizeMB} MB). Upload may take a few minutes...`)
                    } else {
                      setError(null)
                      setProgress('')
                    }
                  } else {
                    setFileInfo('')
                    setProgress('')
                  }
                }}
                required={uploadMethod === 'file'}
              />
              <p className="text-xs text-gray-500 mt-1">
                Supported: GeoJSON (.geojson, .json) or Shapefile (.zip with .shp, .dbf). GeoJSON files can also be in a .zip archive. Files are uploaded to Supabase Storage (no size limit).
              </p>
              {fileInfo && (
                <p className="text-xs text-green-600 mt-1">✓ {fileInfo}</p>
              )}
              <div className="bg-blue-50 p-3 rounded text-xs text-gray-700 mt-2">
                <strong>From HDX:</strong> Download the shapefile (SHP.zip) from the HDX page
                and upload it here. The system will automatically extract and process it.
              </div>
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

      {qualityReport && (
        <QualityReport report={qualityReport} />
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

