'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface DeleteBoundariesButtonProps {
  countryId: string
  boundaryCount?: number
}

export function DeleteBoundariesButton({ countryId, boundaryCount = 0 }: DeleteBoundariesButtonProps) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function handleDelete() {
    if (!confirm(`Are you sure you want to delete ALL ${boundaryCount} admin boundaries for this country? This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
    try {
      const response = await fetch(`/api/admin-boundaries/delete?country_id=${countryId}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        alert(`Error: ${data.error}`)
        return
      }

      alert(`Successfully deleted ${data.deletedCount} admin boundaries`)
      router.refresh()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setDeleting(false)
      setShowConfirm(false)
    }
  }

  if (boundaryCount === 0) {
    return null
  }

  return (
    <div>
      {!showConfirm ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowConfirm(true)}
          className="text-red-600 border-red-300 hover:bg-red-50"
        >
          Delete All Boundaries
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-600 border-red-300 hover:bg-red-50"
          >
            {deleting ? 'Deleting...' : 'Confirm Delete'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConfirm(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

