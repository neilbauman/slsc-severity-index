'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function DatasetDetailPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const datasetId = params.datasetId as string

  const [dataset, setDataset] = useState<any>(null)
  const [previewData, setPreviewData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDataset()
  }, [datasetId])

  const loadDataset = async () => {
    try {
      const supabase = createClient()
      
      const { data: datasetData } = await supabase
        .from('datasets')
        .select('*')
        .eq('id', datasetId)
        .single()

      if (datasetData) {
        setDataset(datasetData)
        await loadPreview(datasetData)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadPreview = async (dataset: any) => {
    if (!dataset.file_path) return

    try {
      const supabase = createClient()
      const { data: fileData, error: fileError } = await supabase.storage
        .from('datasets')
        .download(dataset.file_path)

      if (fileError || !fileData) {
        setError('Failed to load file preview')
        return
      }

      const fileExtension = dataset.file_path.split('.').pop()?.toLowerCase()

      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        // Load xlsx library dynamically
        const XLSX = await import('xlsx')
        const fileBuffer = await fileData.arrayBuffer()
        const workbook = XLSX.read(fileBuffer, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
          raw: false,
          defval: null,
        })
        
        setPreviewData({
          type: 'excel',
          sheetNames: workbook.SheetNames,
          rows: jsonData.slice(0, 100), // Preview first 100 rows
          totalRows: jsonData.length,
          headers: jsonData.length > 0 ? Object.keys(jsonData[0]) : [],
        })
      } else if (fileExtension === 'csv') {
        const text = await fileData.text()
        const lines = text.split('\n').filter(line => line.trim())
        const headers = lines[0]?.split(',') || []
        const rows = lines.slice(1, 101).map((line: string) => {
          const values = line.split(',')
          const row: any = {}
          headers.forEach((h: string, i: number) => {
            row[h.trim()] = values[i]?.trim() || null
          })
          return row
        })

        setPreviewData({
          type: 'csv',
          rows,
          totalRows: lines.length - 1,
          headers,
        })
      } else if (fileExtension === 'json' || fileExtension === 'geojson') {
        const text = await fileData.text()
        const json = JSON.parse(text)
        let rows: any[] = []
        
        if (json.features) {
          rows = json.features.slice(0, 100).map((f: any) => f.properties)
        } else if (Array.isArray(json)) {
          rows = json.slice(0, 100)
        }

        setPreviewData({
          type: 'geojson',
          rows,
          totalRows: json.features?.length || json.length || 0,
          headers: rows.length > 0 ? Object.keys(rows[0]) : [],
        })
      }
    } catch (err: any) {
      console.error('Preview load error:', err)
      setError(`Failed to preview file: ${err.message}`)
    }
  }

  const handleProcess = async () => {
    if (!confirm('Process this dataset? This will analyze data quality and extract information.')) {
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/api/datasets/${datasetId}/process`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Processing failed')
      }

      alert('Processing completed! Check the quality report.')
      await loadDataset() // Reload to show updated status
    } catch (err: any) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Loading...</p>
      </div>
    )
  }

  if (!dataset) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Dataset not found</p>
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
              Dataset: {dataset.name}
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-6xl">
        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Uploaded</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-600">
                {new Date(dataset.uploaded_at).toLocaleString()}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">File</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-600 truncate">
                {dataset.file_path?.split('/').pop() || '—'}
              </p>
            </CardContent>
          </Card>
        </div>

        {previewData && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Data Preview</CardTitle>
                <div className="text-xs text-gray-600">
                  Showing {previewData.rows.length} of {previewData.totalRows} rows
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {previewData.rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {previewData.headers.map((header: string) => (
                          <TableHead key={header} className="text-xs">
                            {header}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.rows.map((row: any, idx: number) => (
                        <TableRow key={idx}>
                          {previewData.headers.map((header: string) => (
                            <TableCell key={header} className="text-xs">
                              {row[header] !== null && row[header] !== undefined
                                ? String(row[header])
                                : '—'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-gray-600">No data to preview</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button
                onClick={handleProcess}
                disabled={processing || dataset.status === 'complete'}
              >
                {processing ? 'Processing...' : 'Process Dataset'}
              </Button>
              {dataset.status === 'complete' && (
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/countries/${code}/core-datasets/${datasetId}/clean`)}
                >
                  View Quality Report
                </Button>
              )}
            </div>
            {dataset.status === 'complete' && (
              <p className="text-xs text-gray-600 mt-2">
                Dataset has been processed. Click "View Quality Report" to see the analysis.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

