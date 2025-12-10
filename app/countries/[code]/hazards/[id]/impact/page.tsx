'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'

export default function HazardImpactPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const hazardId = params.id as string

  const [hazard, setHazard] = useState<any>(null)
  const [datasets, setDatasets] = useState<any[]>([])
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('')
  const [analysisType, setAnalysisType] = useState<'granular' | 'aggregated'>('granular')
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [hazardId])

  const loadData = async () => {
    try {
      const supabase = createClient()

      // Fetch hazard
      const { data: hazardData } = await supabase
        .from('hazards')
        .select('*')
        .eq('id', hazardId)
        .single()

      if (hazardData) {
        setHazard(hazardData)

        // Fetch country ID
        const { data: country } = await supabase
          .from('countries')
          .select('id')
          .eq('code', code.toUpperCase())
          .single()

        if (country) {
          // Fetch raster datasets (GeoTIFF)
          const { data: datasetsData } = await supabase
            .from('datasets')
            .select('*')
            .eq('country_id', country.id)
            .order('uploaded_at', { ascending: false })

          const rasterDatasets = (datasetsData || []).filter((d: any) => {
            const metadata = (d.metadata as any) || {}
            return metadata.fileType === 'raster' || 
                   metadata.format === 'geotiff' ||
                   d.file_path?.toLowerCase().endsWith('.tif') ||
                   d.file_path?.toLowerCase().endsWith('.tiff')
          })

          setDatasets(rasterDatasets)
        }
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async () => {
    if (!selectedDatasetId) {
      setError('Please select a population dataset')
      return
    }

    setAnalyzing(true)
    setError(null)

    try {
      const response = await fetch(`/api/hazards/${hazardId}/impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: selectedDatasetId,
          analysisType,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed')
      }

      setResults(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Loading...</p>
      </div>
    )
  }

  if (!hazard) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Hazard not found</p>
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
              Impact Analysis: {hazard.name}
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-4xl">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Hazard Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-600">Type</p>
                <Badge variant="status-warning">{hazard.type}</Badge>
              </div>
              <div>
                <p className="text-gray-600">Date</p>
                <p className="font-medium">
                  {hazard.date ? new Date(hazard.date).toLocaleDateString() : '—'}
                </p>
              </div>
              <div>
                <p className="text-gray-600">Uploaded</p>
                <p className="font-medium">
                  {new Date(hazard.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Population Impact Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Population Dataset (GeoTIFF Raster)
                </label>
                <select
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                >
                  <option value="">Select a raster population dataset...</option>
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name} ({new Date(dataset.uploaded_at).toLocaleDateString()})
                    </option>
                  ))}
                </select>
                {datasets.length === 0 && (
                  <p className="text-xs text-yellow-600 mt-1">
                    No raster datasets found. Upload a GeoTIFF population dataset (e.g., WorldPop) first.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Analysis Type
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="analysisType"
                      value="granular"
                      checked={analysisType === 'granular'}
                      onChange={(e) => setAnalysisType(e.target.value as 'granular')}
                      className="rounded border-gray-300"
                    />
                    <div>
                      <div className="font-medium text-sm">Granular (Pixel-level)</div>
                      <div className="text-xs text-gray-600">
                        Extract population for each pixel within flood extents. More accurate but slower for large areas.
                      </div>
                    </div>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="analysisType"
                      value="aggregated"
                      checked={analysisType === 'aggregated'}
                      onChange={(e) => setAnalysisType(e.target.value as 'aggregated')}
                      className="rounded border-gray-300"
                    />
                    <div>
                      <div className="font-medium text-sm">Aggregated (Admin-level)</div>
                      <div className="text-xs text-gray-600">
                        Use pre-calculated zonal statistics. Faster but requires zonal statistics to be calculated first.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-3 rounded">
                  {error}
                </div>
              )}

              <Button
                onClick={handleAnalyze}
                disabled={analyzing || !selectedDatasetId}
                className="w-full"
              >
                {analyzing ? 'Analyzing...' : 'Calculate Population Impact'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {results && (
          <Card>
            <CardHeader>
              <CardTitle>Analysis Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {results.metadata?.diagnostic && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                    <p className="text-sm font-semibold text-yellow-900 mb-2">⚠️ Diagnostic Information</p>
                    <p className="text-xs text-yellow-800 mb-2">{results.metadata.diagnostic.warning}</p>
                    {results.metadata.diagnostic.rasterBounds && (
                      <div className="text-xs text-yellow-700">
                        <p><strong>Raster Bounds:</strong> </p>
                        <p className="ml-2">
                          Longitude: {results.metadata.diagnostic.rasterBounds.minX.toFixed(4)} to {results.metadata.diagnostic.rasterBounds.maxX.toFixed(4)}<br/>
                          Latitude: {results.metadata.diagnostic.rasterBounds.minY.toFixed(4)} to {results.metadata.diagnostic.rasterBounds.maxY.toFixed(4)}
                        </p>
                      </div>
                    )}
                    {results.metadata.processingErrors && results.metadata.processingErrors.length > 0 && (
                      <div className="text-xs text-red-700 mt-2">
                        <p><strong>Processing Errors:</strong></p>
                        <ul className="ml-4 list-disc">
                          {results.metadata.processingErrors.map((err: string, idx: number) => (
                            <li key={idx}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Total Affected Population</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {results.results.totalAffectedPopulation.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-xs text-gray-600 mb-1">Affected Pixels</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {results.results.totalAffectedPixels.toLocaleString()}
                    </p>
                  </div>
                  {analysisType === 'granular' && results.results.pixelDetails && (
                    <div className="bg-green-50 p-4 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Pixel Details</p>
                      <p className="text-2xl font-bold text-green-900">
                        {results.results.pixelDetails.length}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">(showing first 1000)</p>
                    </div>
                  )}
                </div>

                {analysisType === 'granular' && results.results.pixelDetails && results.results.pixelDetails.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Pixel-Level Population Distribution</h3>
                    <div className="bg-gray-50 p-3 rounded text-xs">
                      <p className="mb-2">Population values extracted from raster pixels within flood extents.</p>
                      <p>Sample pixels (first 20):</p>
                      <div className="mt-2 max-h-40 overflow-y-auto">
                        <table className="min-w-full text-xs">
                          <thead className="bg-gray-100 sticky top-0">
                            <tr>
                              <th className="px-2 py-1 text-left">Longitude</th>
                              <th className="px-2 py-1 text-left">Latitude</th>
                              <th className="px-2 py-1 text-left">Population</th>
                            </tr>
                          </thead>
                          <tbody>
                            {results.results.pixelDetails.slice(0, 20).map((pixel: any, idx: number) => (
                              <tr key={idx} className="border-t">
                                <td className="px-2 py-1">{pixel.x.toFixed(4)}</td>
                                <td className="px-2 py-1">{pixel.y.toFixed(4)}</td>
                                <td className="px-2 py-1">{pixel.value.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-gray-50 p-3 rounded text-xs">
                  <p className="font-medium mb-1">Analysis Metadata:</p>
                  <ul className="space-y-1 text-gray-600">
                    <li>Raster Dataset: {results.metadata.rasterDataset}</li>
                    <li>Geometry Count: {results.metadata.geometryCount}</li>
                    <li>Calculated: {new Date(results.metadata.calculatedAt).toLocaleString()}</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mt-6 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-sm">💡 About Impact Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs space-y-2 text-gray-700">
              <p>
                <strong>Granular Analysis:</strong> Extracts population values for each pixel of the WorldPop raster 
                that falls within the flood hazard extents. This provides the most accurate estimate of affected 
                population by summing individual pixel values.
              </p>
              <p>
                <strong>Aggregated Analysis:</strong> Uses pre-calculated zonal statistics (population per admin boundary) 
                and finds which boundaries intersect with the hazard. Faster for large areas but less precise than 
                pixel-level analysis.
              </p>
              <p>
                <strong>Recommendation:</strong> Use granular analysis for precise impact assessment. The calculation 
                may take a few minutes for large flood extents, but provides pixel-level accuracy.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

