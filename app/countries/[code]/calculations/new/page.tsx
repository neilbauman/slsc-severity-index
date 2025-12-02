'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function RunCalculationPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const [models, setModels] = useState<any[]>([])
  const [datasets, setDatasets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [countryId, setCountryId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedDataset, setSelectedDataset] = useState<string>('')
  const [populationGroups, setPopulationGroups] = useState<string>('')

  useEffect(() => {
    loadData()
  }, [code])

  async function loadData() {
    try {
      setLoading(true)

      // Get country ID
      const countryResponse = await fetch(`/api/countries?code=${code.toUpperCase()}`)
      if (countryResponse.ok) {
        const countryData = await countryResponse.json()
        if (countryData.countries && countryData.countries.length > 0) {
          const country = countryData.countries[0]
          setCountryId(country.id)

          // Load models and datasets in parallel
          const [modelsResponse, datasetsResponse] = await Promise.all([
            fetch(`/api/calculation-models?country_id=${country.id}&is_active=true`),
            fetch(`/api/datasets/household?country_id=${country.id}`),
          ])

          if (modelsResponse.ok) {
            const modelsData = await modelsResponse.json()
            setModels(modelsData.models || [])
          }

          if (datasetsResponse.ok) {
            const datasetsData = await datasetsResponse.json()
            const completeDatasets = (datasetsData.datasets || []).filter(
              (d: any) => d.status === 'complete'
            )
            setDatasets(completeDatasets)
          }
        }
      }
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleRunCalculation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!countryId || !selectedModel || !selectedDataset) {
      alert('Please select a calculation model and household dataset')
      return
    }

    setRunning(true)

    try {
      const response = await fetch('/api/calculations/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          country_id: countryId,
          calculation_model_id: selectedModel,
          household_dataset_id: selectedDataset,
          options: {
            population_groups: populationGroups
              ? populationGroups.split(',').map(g => g.trim())
              : undefined,
          },
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        alert(`Error: ${result.error}`)
        return
      }

      alert('Calculation started successfully!')
      router.push(`/countries/${code}/calculations`)
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link
              href={`/countries/${code}/calculations`}
              className="text-sm font-semibold text-gray-900"
            >
              ← Calculations
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">
              Run Severity Calculation
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Run New Calculation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
              <strong>💡 What happens here?</strong> The system will:
              <ol className="list-decimal list-inside mt-2 space-y-1 text-xs">
                <li>Calculate <strong>Pillar 1</strong> scores (Shelter: safety, privacy, thermal comfort, tenure)</li>
                <li>Calculate <strong>Pillar 2</strong> scores (NFI: cooking, storage, sleep, hygiene, electricity)</li>
                <li>Calculate <strong>Pillar 3</strong> scores (Services: health, education, water, etc.)</li>
                <li>Apply the <strong>decision tree</strong> to combine pillars into final severity (1-5)</li>
                <li>Aggregate to <strong>administrative areas</strong> using the 20% rule</li>
                <li>Calculate <strong>PIN (People in Need)</strong> figures by area</li>
              </ol>
            </div>
            <p className="text-xs text-gray-600 mb-6">
              Select your calculation model and household dataset below, then click "Run Calculation".
            </p>

            {loading ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600">Loading...</p>
              </div>
            ) : (
              <form onSubmit={handleRunCalculation} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Calculation Model *
                  </label>
                  {models.length === 0 ? (
                    <div className="text-sm text-gray-600 mb-2">
                      No calculation models available.{' '}
                      <Link
                        href={`/countries/${code}/calculation-models`}
                        className="text-blue-600 underline"
                      >
                        Import a model
                      </Link>
                    </div>
                  ) : (
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
                      required
                    >
                      <option value="">Select a calculation model</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name} v{model.version}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Household Dataset *
                  </label>
                  {datasets.length === 0 ? (
                    <div className="text-sm text-gray-600 mb-2">
                      No household datasets available.{' '}
                      <Link
                        href={`/countries/${code}/household-datasets`}
                        className="text-blue-600 underline"
                      >
                        Upload a dataset
                      </Link>
                    </div>
                  ) : (
                    <select
                      value={selectedDataset}
                      onChange={(e) => setSelectedDataset(e.target.value)}
                      className="w-full h-8 px-2 text-sm border border-gray-300 rounded"
                      required
                    >
                      <option value="">Select a household dataset</option>
                      {datasets.map((dataset) => (
                        <option key={dataset.id} value={dataset.id}>
                          {dataset.name} ({dataset.total_households || 0} households)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    Population Groups (optional)
                  </label>
                  <Input
                    type="text"
                    value={populationGroups}
                    onChange={(e) => setPopulationGroups(e.target.value)}
                    placeholder="Comma-separated: IDP, Host community"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Separate multiple groups with commas
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={running || !selectedModel || !selectedDataset || models.length === 0 || datasets.length === 0}
                  >
                    {running ? 'Running Calculation...' : 'Run Calculation'}
                  </Button>
                  <Link href={`/countries/${code}/calculations`}>
                    <Button type="button" variant="ghost">
                      Cancel
                    </Button>
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

