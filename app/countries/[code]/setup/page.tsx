'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export default function SetupPage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string
  const [setupStatus, setSetupStatus] = useState<any>({
    migrationComplete: false,
    hasModel: false,
    hasHouseholdData: false,
    hasAdminBoundaries: false,
  })
  const [loading, setLoading] = useState(true)
  const [countryId, setCountryId] = useState<string | null>(null)

  useEffect(() => {
    checkSetupStatus()
  }, [code])

  async function checkSetupStatus() {
    try {
      // Get country ID
      const countryResponse = await fetch(`/api/countries?code=${code.toUpperCase()}`)
      if (countryResponse.ok) {
        const countryData = await countryResponse.json()
        if (countryData.countries && countryData.countries.length > 0) {
          const country = countryData.countries[0]
          setCountryId(country.id)

          // Check if migration is complete (tables exist)
          const modelsResponse = await fetch(`/api/calculation-models?country_id=${country.id}`)
          const modelsData = await modelsResponse.json()
          
          // Check models
          const hasModel = modelsData.models && modelsData.models.length > 0
          
          // Check household datasets
          const datasetsResponse = await fetch(`/api/datasets/household?country_id=${country.id}`)
          const datasetsData = await datasetsResponse.json()
          const hasHouseholdData = datasetsData.datasets && datasetsData.datasets.length > 0

          setSetupStatus({
            migrationComplete: !modelsData.migrationRequired,
            hasModel,
            hasHouseholdData,
            hasAdminBoundaries: true, // TODO: check admin boundaries
          })
        }
      }
    } catch (error) {
      console.error('Error checking setup status:', error)
    } finally {
      setLoading(false)
    }
  }

  const steps = [
    {
      id: 'migration',
      title: 'Database Setup',
      description: 'One-time setup: Create the database tables needed for calculations',
      status: setupStatus.migrationComplete ? 'complete' : 'pending',
      action: setupStatus.migrationComplete ? null : (
        <Link href="/admin/migrations">
          <Button size="sm">Run Setup</Button>
        </Link>
      ),
      explanation: 'This creates the database tables. You only need to do this once.',
    },
    {
      id: 'model',
      title: 'Import Calculation Model',
      description: 'Upload your Excel calculation template (like the Mozambique file you shared)',
      status: setupStatus.hasModel ? 'complete' : 'pending',
      action: setupStatus.hasModel ? null : (
        <Link href={`/countries/${code}/calculation-models`}>
          <Button size="sm">Import Model</Button>
        </Link>
      ),
      explanation: 'This extracts the calculation rules (pillars, analysis grid, decision tree) from your Excel file.',
    },
    {
      id: 'household',
      title: 'Upload Household Data',
      description: 'Upload your household survey data (extract the "HH dataset" sheet from your Excel file)',
      status: setupStatus.hasHouseholdData ? 'complete' : 'pending',
      action: setupStatus.hasHouseholdData ? null : (
        <Link href={`/countries/${code}/household-datasets`}>
          <Button size="sm">Upload Data</Button>
        </Link>
      ),
      explanation: 'Upload the household-level survey responses. Make sure the file has pcode columns to link to admin boundaries.',
    },
    {
      id: 'calculate',
      title: 'Run Calculation',
      description: 'Calculate severity scores using your model and data',
      status: setupStatus.hasModel && setupStatus.hasHouseholdData ? 'ready' : 'waiting',
      action: (setupStatus.hasModel && setupStatus.hasHouseholdData) ? (
        <Link href={`/countries/${code}/calculations/new`}>
          <Button size="sm">Run Calculation</Button>
        </Link>
      ) : (
        <Button size="sm" disabled>Complete steps above first</Button>
      ),
      explanation: 'This calculates pillar scores for each household, applies the decision tree, and aggregates to area-level severity.',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link
              href={`/countries/${code}`}
              className="text-sm font-semibold text-gray-900"
            >
              ← {code.toUpperCase()}
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">
              Setup Guide
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Getting Started with SSC Calculations</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              Follow these steps in order to upload your data and run calculations. 
              Each step will guide you through what you need to do.
            </p>
            {loading ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-600">Checking setup status...</p>
              </div>
            ) : (
              <div className="space-y-4">
                {steps.map((step, index) => (
                  <Card
                    key={step.id}
                    className={`${
                      step.status === 'complete'
                        ? 'border-green-200 bg-green-50'
                        : step.status === 'ready'
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                          {step.status === 'complete' ? (
                            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-bold">
                              ✓
                            </div>
                          ) : step.status === 'ready' ? (
                            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">
                              {index + 1}
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-bold">
                              {index + 1}
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium">{step.title}</h3>
                            {step.status === 'complete' && (
                              <Badge variant="status-success">Complete</Badge>
                            )}
                            {step.status === 'ready' && (
                              <Badge variant="status-info">Ready</Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mb-2">{step.description}</p>
                          <p className="text-xs text-gray-500 mb-3 italic">
                            💡 {step.explanation}
                          </p>
                          {step.action}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Need Help?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-gray-600">
              <p>
                <strong>What are these SQL migrations?</strong><br />
                They create the database tables needed to store calculation models and household data. 
                You only need to run this once per database. It's like setting up folders on your computer 
                - you need the folders before you can put files in them.
              </p>
              <p>
                <strong>Can I skip steps?</strong><br />
                No - you need to complete steps in order. The calculation needs both the model (how to calculate) 
                and the data (what to calculate).
              </p>
              <p>
                <strong>What if my file is too large?</strong><br />
                If you get an error about file size, extract just the "HH dataset" sheet from your Excel file 
                and upload that separately. The calculation model can be imported from a smaller file with just 
                the methodology sheets.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

