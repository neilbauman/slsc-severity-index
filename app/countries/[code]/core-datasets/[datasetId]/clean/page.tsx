'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { DatasetQualityReport, DatasetQualityIssue } from '@/lib/processing/dataset-quality'

export default function DatasetCleanPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const datasetId = params.datasetId as string

  const [dataset, setDataset] = useState<any>(null)
  const [qualityReport, setQualityReport] = useState<DatasetQualityReport | null>(null)
  const [versions, setVersions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [datasetId])

  const loadData = async () => {
    try {
      const supabase = createClient()
      
      // Fetch dataset
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
      }

      // Fetch versions
      const { data: versionsData } = await supabase
        .from('dataset_versions')
        .select('*')
        .eq('dataset_id', datasetId)
        .order('version_number', { ascending: false })

      if (versionsData) {
        setVersions(versionsData)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClean = async (issue: DatasetQualityIssue) => {
    if (!confirm(`This will clean ${issue.affectedCount} rows. A backup will be created automatically. Continue?`)) {
      return
    }

    setCleaning(true)
    setError(null)

    try {
      const response = await fetch(`/api/datasets/${datasetId}/clean`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: {
            type: issue.type,
            issue: issue,
          },
          createBackup: true,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Cleaning failed')
      }

      // Reload data
      await loadData()
      alert(`Cleaning completed. ${data.fixedCount} rows fixed.`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCleaning(false)
    }
  }

  const handleRevert = async (versionId: string, versionNumber: number) => {
    if (!confirm(`This will revert to version ${versionNumber}. The current version will be backed up. Continue?`)) {
      return
    }

    setCleaning(true)
    setError(null)

    try {
      const response = await fetch(`/api/datasets/${datasetId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Revert failed')
      }

      // Reload data
      await loadData()
      alert(`Successfully reverted to version ${versionNumber}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCleaning(false)
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
              onClick={() => router.back()}
              className="text-sm font-semibold text-gray-900 hover:underline"
            >
              ← Back
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              Clean Dataset: {dataset?.name || 'Loading...'}
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
                <Badge
                  variant="custom"
                  className={`text-lg font-bold border-2 ${getScoreColor(qualityReport.overallScore)}`}
                  style={{ borderColor: 'currentColor', backgroundColor: 'transparent' }}
                >
                  {qualityReport.overallScore}/100
                </Badge>
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
                    <p className="text-gray-600">With Population</p>
                    <p className="font-semibold">{qualityReport.summary.completeness.hasPopulation}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Issues</p>
                    <p className="font-semibold">{qualityReport.issues.length}</p>
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
                                  View {issue.affectedCount} affected rows
                                </summary>
                                <div className="mt-2 space-y-1">
                                  {issue.affectedRows.slice(0, 10).map((row, i) => (
                                    <div key={i} className="text-gray-600">
                                      {row.pcode && `Pcode: ${row.pcode}`}
                                      {row.name && `, Name: ${row.name}`}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                          {issue.autoFixable && (
                            <Button
                              size="sm"
                              onClick={() => handleClean(issue)}
                              disabled={cleaning}
                            >
                              Fix
                            </Button>
                          )}
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
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Version History</CardTitle>
          </CardHeader>
          <CardContent>
            {versions.length > 0 ? (
              <div className="space-y-2">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <p className="font-semibold">Version {version.version_number}</p>
                      <p className="text-xs text-gray-600">
                        {version.description || 'No description'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(version.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRevert(version.id, version.version_number)}
                      disabled={cleaning}
                    >
                      Revert
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600">No versions available yet</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

