'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const MIGRATIONS = [
  { name: 'create_ssc_calculation_tables', description: 'Create SSC calculation tables (calculation_models, household_datasets, household_records)' },
  { name: 'add_dataset_versions', description: 'Add dataset versioning support' },
  { name: 'add_datasets_rls_policies', description: 'Add RLS policies for datasets' },
  { name: 'create_datasets_bucket', description: 'Create storage bucket for datasets' },
  { name: 'fix_user_country_permissions_recursion', description: 'Fix user country permissions recursion' },
]

export default function MigrationsPage() {
  const [selectedMigration, setSelectedMigration] = useState<string | null>(null)
  const [sql, setSql] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)

  useEffect(() => {
    if (selectedMigration) {
      loadMigration(selectedMigration)
    }
  }, [selectedMigration])

  async function loadMigration(name: string) {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/migrations/run?name=${name}`)
      const data = await response.json()
      if (data.success) {
        setSql(data.sql)
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch (error: any) {
      alert(`Error loading migration: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(sql)
      alert('SQL copied to clipboard!')
    } catch (error) {
      alert('Failed to copy to clipboard')
    }
  }

  async function executeMigration() {
    if (!confirm('Are you sure you want to execute this migration? This will modify your database.')) {
      return
    }

    setExecuting(true)
    try {
      const response = await fetch('/api/admin/migrations/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
      })

      const data = await response.json()
      if (data.success) {
        alert('Migration executed successfully!')
      } else {
        alert(`Migration execution note: ${data.message || data.error}\n\nPlease execute the SQL manually in your Supabase SQL Editor.`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <h1 className="text-lg font-semibold text-gray-900">
            Database Migrations
          </h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Available Migrations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              <strong>💡 What are migrations?</strong> These are SQL scripts that create the database tables 
              needed for the app. Think of it like setting up folders on your computer - you need the folders 
              before you can put files in them. <strong>You only need to run "create_ssc_calculation_tables" once</strong> 
              to set up the calculation features.
            </div>
            <p className="text-xs text-gray-600 mb-4">
              Select a migration to view and execute its SQL. For security, migrations should be
              executed through your Supabase SQL Editor. You can copy the SQL and run it there.
            </p>
            <div className="space-y-2">
              {MIGRATIONS.map((migration) => (
                <button
                  key={migration.name}
                  onClick={() => setSelectedMigration(migration.name)}
                  className={`w-full text-left p-3 border rounded hover:bg-gray-50 ${
                    selectedMigration === migration.name ? 'border-blue-500 bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{migration.name}</div>
                      <div className="text-xs text-gray-600 mt-1">{migration.description}</div>
                    </div>
                    {selectedMigration === migration.name && (
                      <Badge variant="secondary">Selected</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {selectedMigration && (
          <Card>
            <CardHeader>
              <CardTitle>Migration SQL: {selectedMigration}</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-600">Loading migration SQL...</p>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <textarea
                      value={sql}
                      onChange={(e) => setSql(e.target.value)}
                      className="w-full h-96 p-3 font-mono text-xs border border-gray-300 rounded bg-gray-50"
                      readOnly={false}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={copyToClipboard} variant="outline">
                      Copy SQL
                    </Button>
                    <Button onClick={executeMigration} disabled={executing || !sql}>
                      {executing ? 'Executing...' : 'Execute Migration'}
                    </Button>
                    <div className="flex-1"></div>
                    <a
                      href="https://supabase.com/dashboard"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline self-center"
                    >
                      Open Supabase SQL Editor →
                    </a>
                  </div>
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                    <strong>Note:</strong> For security reasons, DDL migrations (CREATE TABLE, ALTER TABLE, etc.) 
                    cannot be executed directly through the API. Please copy the SQL above and execute it in your 
                    Supabase Dashboard → SQL Editor. The Execute button will attempt to run it but may require 
                    manual execution.
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}

