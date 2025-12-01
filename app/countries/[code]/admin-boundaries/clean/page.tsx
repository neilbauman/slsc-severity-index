'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QualityReport } from '@/components/admin-boundaries/quality-report'
import { createClient } from '@/lib/supabase/client'

interface QualityIssue {
  severity: 'error' | 'warning' | 'info'
  type: string
  message: string
  affectedCount: number
  affectedItems: Array<{
    id?: string
    name: string
    level: number
    pcode?: string | null
    details?: Record<string, any>
  }>
  recommendation: string
  autoFixable?: boolean
}

interface QualityReportData {
  overallScore: number
  totalBoundaries: number
  issues: QualityIssue[]
  summary: {
    byLevel: Record<number, {
      count: number
      withPcode: number
      withParent: number
      issues: number
    }>
    completeness: {
      hasPcode: number
      hasParent: number
      hasGeometry: number
    }
  }
  recommendations: string[]
}

export default function CleanDataPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  
  const [loading, setLoading] = useState(true)
  const [cleaning, setCleaning] = useState(false)
  const [qualityReport, setQualityReport] = useState<QualityReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [countryId, setCountryId] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const supabase = createClient()
        
        // Get country ID
        const { data: country } = await supabase
          .from('countries')
          .select('id')
          .eq('code', code.toUpperCase())
          .single()

        if (!country) {
          setError('Country not found')
          return
        }

        setCountryId(country.id)

        // Load quality report
        const response = await fetch(`/api/admin-boundaries/clean?countryId=${country.id}`)
        if (!response.ok) {
          throw new Error('Failed to load quality report')
        }

        const data = await response.json()
        setQualityReport(data.qualityReport)
      } catch (err: any) {
        setError(err.message || 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [code])

  const handleCleanAction = async (action: string, issueType: string, affectedItems: QualityIssue['affectedItems']) => {
    if (!countryId) return

    setCleaning(true)
    setError(null)

    try {
      const affectedIds = affectedItems
        .map(item => item.id)
        .filter((id): id is string => !!id)

      if (affectedIds.length === 0) {
        setError('No items selected for cleaning')
        setCleaning(false)
        return
      }

      const response = await fetch('/api/admin-boundaries/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryId,
          action,
          issueType,
          affectedIds,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Cleaning action failed')
      }

      const data = await response.json()
      
      // Update quality report with new data
      if (data.qualityReport) {
        setQualityReport(data.qualityReport)
      }

      alert(data.message || 'Cleaning action completed successfully')
    } catch (err: any) {
      setError(err.message || 'Failed to perform cleaning action')
    } finally {
      setCleaning(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg">Loading quality report...</div>
        </div>
      </div>
    )
  }

  if (error && !qualityReport) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-red-600">{error}</div>
              <Button onClick={() => router.back()} className="mt-4">
                Go Back
              </Button>
            </CardContent>
          </Card>
        </div>
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
              Data Quality & Cleaning
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-900 text-sm">
            {error}
          </div>
        )}

        {qualityReport && (
          <>
            <QualityReport 
              report={qualityReport} 
              onCleanAction={handleCleanAction}
              cleaning={cleaning}
            />

            {/* Cleaning Actions */}
            {qualityReport.issues.length > 0 && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Cleaning Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {qualityReport.issues.map((issue, idx) => (
                    <div
                      key={idx}
                      className="p-4 border rounded-lg"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-semibold">{issue.message}</h3>
                          <p className="text-sm text-gray-600 mt-1">
                            {issue.recommendation}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {issue.type === 'duplicate_name' && issue.autoFixable && (
                            <Button
                              size="sm"
                              onClick={() => handleCleanAction('delete_duplicates', issue.type, issue.affectedItems)}
                              disabled={cleaning}
                            >
                              {cleaning ? 'Cleaning...' : 'Merge Duplicates'}
                            </Button>
                          )}
                          {issue.type === 'missing_geometry' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleCleanAction('delete_invalid', issue.type, issue.affectedItems)}
                              disabled={cleaning}
                            >
                              {cleaning ? 'Deleting...' : 'Delete Invalid'}
                            </Button>
                          )}
                          {issue.type === 'invalid_parent_level' && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleCleanAction('delete_invalid', issue.type, issue.affectedItems)}
                              disabled={cleaning}
                            >
                              {cleaning ? 'Deleting...' : 'Delete Invalid'}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        Affects {issue.affectedCount} boundary{issue.affectedCount !== 1 ? 'ies' : ''}
                      </div>
                    </div>
                  ))}
                  
                  <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900">
                    <strong>Note:</strong> Cleaning actions are irreversible. Please review the affected items carefully before proceeding. 
                    Some issues (like orphaned boundaries) may require manual review and fixing in your source data.
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  )
}

