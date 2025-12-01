'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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

interface QualityReport {
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

interface QualityReportProps {
  report: QualityReport | null
}

export function QualityReport({ report }: QualityReportProps) {
  if (!report) {
    return null
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error':
        return <span className="text-red-600 text-lg">⚠</span>
      case 'warning':
        return <span className="text-yellow-600 text-lg">⚠</span>
      case 'info':
        return <span className="text-blue-600 text-lg">ℹ</span>
      default:
        return <span className="text-lg">ℹ</span>
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error':
        return 'bg-red-50 border-red-200 text-red-900'
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-900'
      case 'info':
        return 'bg-blue-50 border-blue-200 text-blue-900'
      default:
        return 'bg-gray-50 border-gray-200'
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Data Quality Report</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Overall Score:</span>
              <Badge
                variant="custom"
                className={`text-lg font-bold border-2 ${getScoreColor(report.overallScore)}`}
                style={{ borderColor: 'currentColor', backgroundColor: 'transparent' }}
              >
                {report.overallScore}/100
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary Statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Total Boundaries</div>
              <div className="text-2xl font-bold">{report.totalBoundaries}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">With Pcode</div>
              <div className="text-2xl font-bold">
                {report.summary.completeness.hasPcode}
              </div>
              <div className="text-xs text-gray-500">
                {Math.round(
                  (report.summary.completeness.hasPcode / report.totalBoundaries) *
                    100
                )}
                %
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">With Parent</div>
              <div className="text-2xl font-bold">
                {report.summary.completeness.hasParent}
              </div>
              <div className="text-xs text-gray-500">
                {Math.round(
                  (report.summary.completeness.hasParent / report.totalBoundaries) *
                    100
                )}
                %
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="text-sm text-gray-600">Issues Found</div>
              <div className="text-2xl font-bold">{report.issues.length}</div>
            </div>
          </div>

          {/* Issues List */}
          {report.issues.length > 0 ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Issues & Recommendations</h3>
              {report.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border ${getSeverityColor(issue.severity)}`}
                >
                  <div className="flex items-start gap-3">
                    {getSeverityIcon(issue.severity)}
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
                      
                      {issue.affectedItems.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-sm cursor-pointer hover:underline">
                            View {issue.affectedCount} affected items
                            {issue.affectedItems.length < issue.affectedCount &&
                              ` (showing first ${issue.affectedItems.length})`}
                          </summary>
                          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {issue.affectedItems.map((item, itemIdx) => (
                              <div
                                key={itemIdx}
                                className="text-xs p-2 bg-white/50 rounded flex items-center gap-2"
                              >
                                <Badge variant="secondary" className="text-xs">
                                  L{item.level}
                                </Badge>
                                <span className="font-medium">{item.name}</span>
                                {item.pcode && (
                                  <code className="text-xs bg-white px-1 rounded">
                                    {item.pcode}
                                  </code>
                                )}
                                {item.details &&
                                  Object.entries(item.details).map(([key, value]) => (
                                    <span key={key} className="text-gray-600">
                                      {key}: {String(value)}
                                    </span>
                                  ))}
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
            <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
              <span className="text-green-600 text-xl">✓</span>
              <div>
                <div className="font-semibold text-green-900">
                  No issues found!
                </div>
                <div className="text-sm text-green-700">
                  Your data quality looks excellent.
                </div>
              </div>
            </div>
          )}

          {/* Recommendations Summary */}
          {report.recommendations.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold text-lg mb-2">Quick Actions</h3>
              <ul className="space-y-1">
                {report.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-sm flex items-start gap-2">
                    <span className="text-gray-400">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Level Summary */}
          {Object.keys(report.summary.byLevel).length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold text-lg mb-2">Summary by Level</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {Object.entries(report.summary.byLevel)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([level, stats]) => (
                    <div
                      key={level}
                      className="p-3 bg-gray-50 rounded border"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary">Level {level}</Badge>
                        <span className="text-sm font-medium">
                          {stats.count} boundaries
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 space-y-1">
                        <div>
                          {stats.withPcode}/{stats.count} with pcode (
                          {Math.round((stats.withPcode / stats.count) * 100)}%)
                        </div>
                        <div>
                          {stats.withParent}/{stats.count} with parent (
                          {Math.round((stats.withParent / stats.count) * 100)}%)
                        </div>
                        {stats.issues > 0 && (
                          <div className="text-yellow-600 font-medium">
                            {stats.issues} issues
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

