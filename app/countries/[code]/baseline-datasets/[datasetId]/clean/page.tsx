'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { DatasetQualityReport, DatasetQualityIssue } from '@/lib/processing/dataset-quality'

export default function BaselineDatasetCleanPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const datasetId = params.datasetId as string

  const [dataset, setDataset] = useState<any>(null)
  const [qualityReport, setQualityReport] = useState<DatasetQualityReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [datasetId])

  const loadData = async () => {
    try {
      const supabase = createClient()
      
      const { data: datasetData } = await supabase
        .from('datasets')
        .select('*')
        .eq('id', datasetId)
        .single()

      if (datasetData) {
        setDataset(datasetData)
      }

      // Fetch quality report
      const response = await fetch(`/api/datasets/${datasetId}/quality`)
      if (response.ok) {
        const report = await response.json()
        setQualityReport(report)
      } else {
        console.error('Failed to fetch quality report:', response.statusText)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error':
        return 'border-red-200 bg-red-50'
      case 'warning':
        return 'border-yellow-200 bg-yellow-50'
      case 'info':
        return 'border-blue-200 bg-blue-50'
      default:
        return 'border-gray-200 bg-gray-50'
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 border-green-600'
    if (score >= 60) return 'text-yellow-600 border-yellow-600'
    return 'text-red-600 border-red-600'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push(`/countries/${code}/baseline-datasets/${datasetId}`)}
              className="text-sm font-semibold text-gray-900 hover:underline"
            >
              ← Back to Dataset
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              Quality Report: {dataset?.name || 'Loading...'}
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        {qualityReport && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Data Quality Report</CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setLoading(true)
                      await loadData()
                    }}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                  <Badge
                    variant="custom"
                    className={`text-lg font-bold border-2 ${getScoreColor(qualityReport.overallScore)}`}
                    style={{ borderColor: 'currentColor', backgroundColor: 'transparent' }}
                  >
                    {qualityReport.overallScore}/100
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Total Rows</p>
                    <p className="font-semibold">{qualityReport.totalRows}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">With Pcode</p>
                    <p className="font-semibold">{qualityReport.summary.completeness.hasPcode}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Issues</p>
                    <p className="font-semibold">{qualityReport.issues.length}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Unmatched Pcodes</p>
                    <p className="font-semibold">
                      {qualityReport.summary.validation.missingMatches}
                    </p>
                  </div>
                </div>

                {qualityReport.issues.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-lg">Issues & Recommendations</h3>
                    {qualityReport.issues.map((issue, idx) => (
                      <div key={idx} className={`p-4 rounded-lg border ${getSeverityColor(issue.severity)}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold">{issue.message}</h4>
                              {issue.autoFixable && (
                                <Badge variant="secondary" className="text-xs">
                                  Auto-fixable
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm mb-3">{issue.recommendation}</p>
                            {issue.affectedRows && issue.affectedRows.length > 0 && (
                              <details className="text-xs">
                                <summary className="cursor-pointer text-gray-600">
                                  View {Math.min(issue.affectedCount, 20)} affected rows
                                </summary>
                                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                                  {issue.affectedRows.slice(0, 20).map((row, i) => (
                                    <div key={i} className="text-gray-600">
                                      {row.pcode && `Pcode: ${row.pcode}`}
                                      {row.name && `, Name: ${row.name}`}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-green-600">
                    <span className="text-4xl">✓</span>
                    <p className="text-lg font-semibold mt-2">No data quality issues found!</p>
                  </div>
                )}

                {qualityReport.recommendations.length > 0 && (
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                    <h4 className="font-semibold text-sm mb-2">Recommendations</h4>
                    <ul className="text-xs space-y-1">
                      {qualityReport.recommendations.map((rec, idx) => (
                        <li key={idx}>• {rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {!qualityReport && !loading && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-600">
                No quality report available. Please process the dataset first.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}

