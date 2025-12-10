'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function BaselineDatasetDetailPage() {
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
        .select('*, dataset_types(name, badge_color, data_type)')
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
      const metadata = (dataset.metadata as any) || {}
      const adminLevel = metadata.adminLevel !== undefined ? parseInt(String(metadata.adminLevel), 10) : undefined

      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        const XLSX = await import('xlsx')
        const fileBuffer = await fileData.arrayBuffer()
        const workbook = XLSX.read(fileBuffer, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { 
          raw: false,
          defval: null,
        })
        
        setPreviewData({
          type: 'excel',
          sheetNames: workbook.SheetNames,
          rows: jsonData.slice(0, 100),
          totalRows: jsonData.length,
          headers: jsonData.length > 0 ? Object.keys(jsonData[0] as Record<string, any>) : [],
        })
      } else if (fileExtension === 'csv') {
        const text = await fileData.text()
        const { processCSVFile } = await import('@/lib/processing/csv-processor')
        
        const result = await processCSVFile(text, {
          filterAdminLevel: !isNaN(adminLevel || NaN) ? adminLevel : undefined,
          filterTotalPopulationOnly: false, // Baseline datasets don't filter by population
        })

        setPreviewData({
          type: 'csv',
          rows: result.rows.slice(0, 100),
          totalRows: result.rows.length,
          headers: result.headers,
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
    if (!confirm('Process this dataset? This will analyze data quality and validate pcodes against admin boundaries.')) {
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

      if (data.qualityReport) {
        const report = data.qualityReport
        const unmatchedCount = report.issues.find((i: any) => i.type === 'unmatched_pcode')?.affectedCount || 0
        const missingCount = report.issues.find((i: any) => i.type === 'missing_boundary_data')?.affectedCount || 0
        
        let message = `Processing completed!\n\nQuality Score: ${report.overallScore}/100\n`
        if (unmatchedCount > 0) {
          message += `⚠️ ${unmatchedCount} pcodes don't match admin boundaries\n`
        }
        if (missingCount > 0) {
          message += `ℹ️ ${missingCount} admin boundaries don't have data\n`
        }
        message += `\nClick "View Quality Report" to see details.`
        alert(message)
      } else {
        alert('Processing completed!')
      }
      await loadDataset()
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

  const metadata = (dataset.metadata as any) || {}
  const datasetType = dataset.dataset_types
  const categoryColumns = metadata.columns?.categoryColumns || []

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push(`/countries/${code}/baseline-datasets`)}
              className="text-sm font-semibold text-gray-900 hover:underline"
            >
              ← Back to Baseline Datasets
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              Baseline Dataset: {dataset.name}
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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
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
              <CardTitle className="text-sm">Type</CardTitle>
            </CardHeader>
            <CardContent>
              {datasetType ? (
                <Badge
                  variant="custom"
                  style={{
                    backgroundColor: datasetType.badge_color || '#gray',
                    color: '#fff',
                  }}
                >
                  {datasetType.name}
                </Badge>
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Uploaded</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-600">
                {new Date(dataset.uploaded_at).toLocaleDateString()}
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

        {metadata.columns && (
          <Card className="mb-6 border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="text-sm">Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs space-y-1">
                {metadata.adminLevel !== null && metadata.adminLevel !== undefined && (
                  <p>
                    <span className="font-medium">Admin Level:</span> ADM{metadata.adminLevel}
                  </p>
                )}
                {metadata.columns?.pcode && (
                  <p>
                    <span className="font-medium">Pcode Column:</span> {metadata.columns.pcode}
                  </p>
                )}
                {categoryColumns.length > 0 && (
                  <p>
                    <span className="font-medium">Category Columns:</span> {categoryColumns.join(', ')}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

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
                          <TableHead 
                            key={header} 
                            className={`text-xs ${
                              header === metadata.columns?.pcode
                                ? 'bg-blue-100'
                                : categoryColumns.includes(header)
                                ? 'bg-yellow-100'
                                : ''
                            }`}
                          >
                            {header}
                            {header === metadata.columns?.pcode && (
                              <span className="ml-1 text-blue-600">(pcode)</span>
                            )}
                            {categoryColumns.includes(header) && (
                              <span className="ml-1 text-yellow-600">(category)</span>
                            )}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.rows.map((row: any, idx: number) => (
                        <TableRow key={idx}>
                          {previewData.headers.map((header: string) => (
                            <TableCell 
                              key={header} 
                              className={`text-xs ${
                                header === metadata.columns?.pcode
                                  ? 'bg-blue-50'
                                  : categoryColumns.includes(header)
                                  ? 'bg-yellow-50'
                                  : ''
                              }`}
                            >
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
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleProcess}
                disabled={processing || dataset.status === 'complete'}
              >
                {processing ? 'Processing...' : dataset.status === 'processing' ? 'Process Dataset' : 'Validate Dataset'}
              </Button>
              {dataset.status === 'complete' && (
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/countries/${code}/baseline-datasets/${datasetId}/clean`)}
                >
                  View Quality Report
                </Button>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {dataset.status === 'processing' 
                ? 'Click "Process Dataset" to validate data quality and check pcode matching against admin boundaries.'
                : dataset.status === 'complete'
                ? 'Dataset has been processed. Click "View Quality Report" to see the validation results.'
                : 'Validate the dataset to check data quality and pcode matching.'}
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

