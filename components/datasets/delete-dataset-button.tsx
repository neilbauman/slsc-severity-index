'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface DeleteDatasetButtonProps {
  datasetId: string
  datasetName: string
}

export function DeleteDatasetButton({ datasetId, datasetName }: DeleteDatasetButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${datasetName}"? This action cannot be undone.`)) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/datasets/${datasetId}/delete`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete dataset')
      }

      // Refresh the page to show updated list
      router.refresh()
    } catch (err: any) {
      setError(err.message || 'Delete failed')
      setLoading(false)
    }
  }

  return (
    <div>
      {error && (
        <div className="text-xs text-red-600 mb-1">{error}</div>
      )}
      <Button
        size="sm"
        variant="secondary"
        onClick={handleDelete}
        disabled={loading}
        className="text-red-600 hover:text-red-700 hover:bg-red-50"
      >
        {loading ? 'Deleting...' : 'Delete'}
      </Button>
    </div>
  )
}

