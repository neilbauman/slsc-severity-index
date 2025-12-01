'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import * as XLSX from 'xlsx'

type Step = 'upload' | 'configure'

export default function UploadCoreDatasetPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [datasetName, setDatasetName] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<{
    headers: string[]
    rows: any[]
    totalRows: number
  } | null>(null)
  const [adminLevel, setAdminLevel] = useState<number>(0)
  const [availableAdminLevels, setAvailableAdminLevels] = useState<Array<{ level: number; name: string }>>([])
  const [pcodeColumn, setPcodeColumn] = useState<string>('')
  const [populationColumn, setPopulationColumn] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')

  // Fetch country admin levels on mount
  useEffect(() => {
    const fetchAdminLevels = async () => {
      const supabase = createClient()
      const { data: country } = await supabase
        .from('countries')
        .select('config')
        .eq('code', code.toUpperCase())
        .single()

      if (country?.config) {
        const config = country.config as any
        if (config.adminLevels && Array.isArray(config.adminLevels)) {
          setAvailableAdminLevels(config.adminLevels)
          if (config.adminLevels.length > 0) {
            setAdminLevel(config.adminLevels[0].level || 0)
          }
        }
      }
    }
    fetchAdminLevels()
  }, [code])

  const loadPreview = async (file: File) => {
    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      let headers: string[] = []
      let rows: any[] = []
      let totalRows = 0

      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        const fileBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(fileBuffer, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, {
          raw: false,
          defval: null,
        })
        rows = jsonData.slice(0, 100) // Preview first 100 rows
        totalRows = jsonData.length
        headers = jsonData.length > 0 ? Object.keys(jsonData[0] as Record<string, any>) : []
      } else if (fileExtension === 'csv') {
        const text = await file.text()
        const Papa = (await import('papaparse')).default
        const parseResult = Papa.parse<Record<string, any>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => header.trim(),
          transform: (value: string) => value.trim() || null,
          preview: 100, // Preview first 100 rows
        })
        rows = parseResult.data
        totalRows = parseResult.data.length + (parseResult.errors.length > 0 ? 0 : parseResult.meta.cursor || 0)
        headers = parseResult.meta.fields || []
      } else if (fileExtension === 'json' || fileExtension === 'geojson') {
        const text = await file.text()
        const json = JSON.parse(text)
        let data: any[] = []
        if (json.features) {
          data = json.features.map((f: any) => f.properties)
        } else if (Array.isArray(json)) {
          data = json
        }
        rows = data.slice(0, 100)
        totalRows = data.length
        headers = rows.length > 0 ? Object.keys(rows[0]) : []
      }

      // Auto-detect columns
      let detectedPcode = ''
      let detectedPopulation = ''

      headers.forEach((header) => {
        const lowerHeader = header.toLowerCase()
        if (!detectedPcode) {
          if (
            lowerHeader.includes('pcode') ||
            (lowerHeader.includes('adm') && lowerHeader.includes('code')) ||
            lowerHeader === 'code' ||
            lowerHeader.includes('admin_code')
          ) {
            detectedPcode = header
          }
        }
        if (!detectedPopulation) {
          if (
            lowerHeader.includes('pop') ||
            lowerHeader.includes('population') ||
            (lowerHeader.includes('total') && lowerHeader.includes('pop')) ||
            lowerHeader === 'people'
          ) {
            detectedPopulation = header
          }
        }
      })

      setPcodeColumn(detectedPcode)
      setPopulationColumn(detectedPopulation)
      setPreviewData({ headers, rows, totalRows })
    } catch (err: any) {
      setError(`Failed to preview file: ${err.message}`)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null
    if (selectedFile) {
      setFile(selectedFile)
      if (!datasetName) {
        const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, '')
        setDatasetName(nameWithoutExt)
      }
      await loadPreview(selectedFile)
    }
  }

  const handleUpload = async (e: React.FormEvent) => {
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

      // Check if user is authenticated
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) {
        throw new Error('You must be logged in to upload files')
      }

      // Upload file to Supabase Storage
      setProgress('Uploading file to storage...')
      const timestamp = Date.now()
      const fileName = `${code}-${timestamp}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const path = `${code}/core-datasets/${fileName}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('datasets')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        const errorMessage = uploadError.message || String(uploadError)
        if (errorMessage.includes('Bucket not found') || errorMessage.includes('does not exist') || errorMessage.includes('400')) {
          throw new Error(
            'Storage bucket "datasets" not found. Please create it in Supabase Storage or run the migration: migrations/create_datasets_bucket.sql'
          )
        }
        throw new Error(`Failed to upload file: ${errorMessage}`)
      }

      setFilePath(path)
      setStep('configure')
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      setLoading(false)
    }
  }

  const handleConfigure = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setProgress('')

    if (!pcodeColumn) {
      setError('Please select a pcode column')
      return
    }

    if (!populationColumn) {
      setError('Please select a population column')
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

      setProgress('Creating dataset record...')

      // Create dataset record via API with metadata
      const createResponse = await fetch('/api/datasets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryId: country.id,
          datasetName,
          filePath,
          metadata: {
            adminLevel,
            columns: {
              pcode: pcodeColumn,
              population: populationColumn,
            },
          },
        }),
      })

      const createData = await createResponse.json()

      if (!createResponse.ok) {
        throw new Error(createData.error || 'Failed to create dataset record')
      }

      setProgress('Dataset uploaded successfully!')

      // Use window.location for a hard refresh
      setTimeout(() => {
        window.location.href = `/countries/${code}/core-datasets`
      }, 1000)
    } catch (err: any) {
      setError(err.message || 'Configuration failed')
      setLoading(false)
    }
  }

  if (step === 'configure' && previewData) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep('upload')}
                className="text-sm font-semibold text-gray-900 hover:underline"
              >
                ← Back
              </button>
              <h1 className="text-lg font-semibold text-gray-900">
                Configure Dataset
              </h1>
              <div></div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-6 max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle>Dataset Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleConfigure} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Administrative Level *
                    </label>
                    <select
                      value={adminLevel}
                      onChange={(e) => setAdminLevel(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                      required
                    >
                      {availableAdminLevels.map((level) => (
                        <option key={level.level} value={level.level}>
                          Level {level.level}: {level.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Select the admin level this dataset represents
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Pcode Column *
                    </label>
                    <select
                      value={pcodeColumn}
                      onChange={(e) => setPcodeColumn(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                      required
                    >
                      <option value="">Select column...</option>
                      {previewData.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Column containing administrative unit codes
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Population Column *
                    </label>
                    <select
                      value={populationColumn}
                      onChange={(e) => setPopulationColumn(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                      required
                    >
                      <option value="">Select column...</option>
                      {previewData.headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Column containing population values
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Data Preview ({previewData.totalRows} total rows)
                  </label>
                  <div className="overflow-x-auto border border-gray-200 rounded-md max-h-96">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {previewData.headers.map((header) => (
                            <th
                              key={header}
                              className={`px-2 py-2 text-left font-medium text-gray-700 ${
                                header === pcodeColumn || header === populationColumn
                                  ? 'bg-blue-100'
                                  : ''
                              }`}
                            >
                              {header}
                              {header === pcodeColumn && (
                                <span className="ml-1 text-blue-600">(pcode)</span>
                              )}
                              {header === populationColumn && (
                                <span className="ml-1 text-blue-600">(population)</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {previewData.rows.slice(0, 10).map((row, idx) => (
                          <tr key={idx}>
                            {previewData.headers.map((header) => (
                              <td
                                key={header}
                                className={`px-2 py-1 ${
                                  header === pcodeColumn || header === populationColumn
                                    ? 'bg-blue-50'
                                    : ''
                                }`}
                              >
                                {row[header] !== null && row[header] !== undefined
                                  ? String(row[header])
                                  : '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                    {loading ? 'Saving...' : 'Save Configuration'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setStep('upload')}
                  >
                    Back
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    )
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
            <form onSubmit={handleUpload} className="space-y-4">
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
                  onChange={handleFileSelect}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Supported formats: CSV, Excel (.xlsx, .xls), GeoJSON (.geojson, .json)
                </p>
              </div>

              {previewData && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-xs font-medium text-blue-900 mb-1">
                    Preview loaded: {previewData.totalRows} rows, {previewData.headers.length} columns
                  </p>
                  <p className="text-xs text-blue-700">
                    Detected columns: {previewData.headers.slice(0, 5).join(', ')}
                    {previewData.headers.length > 5 && '...'}
                  </p>
                </div>
              )}

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
                <Button type="submit" disabled={loading || !previewData} className="flex-1">
                  {loading ? 'Uploading...' : 'Upload & Configure'}
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
