'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CountryConfig, PHILIPPINES_CONFIG } from '@/lib/config/country-config'

export function CountryForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [adminLevels, setAdminLevels] = useState([
    { level: 0, name: '', pcodePattern: '' },
  ])

  const addAdminLevel = () => {
    setAdminLevels([
      ...adminLevels,
      { level: adminLevels.length, name: '', pcodePattern: '' },
    ])
  }

  const removeAdminLevel = (index: number) => {
    const updated = adminLevels.filter((_, i) => i !== index)
    // Renumber levels after removal
    const renumbered = updated.map((level, i) => ({
      ...level,
      level: i,
    }))
    setAdminLevels(renumbered)
  }

  const updateAdminLevel = (
    index: number,
    field: 'name' | 'pcodePattern',
    value: string
  ) => {
    const updated = [...adminLevels]
    updated[index] = { ...updated[index], [field]: value }
    setAdminLevels(updated)
  }

  const loadPhilippinesTemplate = () => {
    setName('Philippines')
    setCode('PHL')
    setAdminLevels(
      PHILIPPINES_CONFIG.adminLevels.map((level) => ({
        level: level.level,
        name: level.name,
        pcodePattern: level.pcodePattern,
      }))
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name || !code) {
      setError('Name and code are required')
      return
    }

    if (code.length !== 3) {
      setError('Country code must be 3 characters')
      return
    }

    if (adminLevels.some((level) => !level.name)) {
      setError('All admin levels must have a name')
      return
    }

    setLoading(true)

    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setError('You must be logged in')
      setLoading(false)
      return
    }

    const config: CountryConfig = {
      countryCode: code.toUpperCase(),
      adminLevels: adminLevels.map((level) => ({
        level: level.level,
        name: level.name,
        pcodePattern: level.pcodePattern,
      })),
    }

    const { error: dbError } = await supabase.from('countries').insert({
      name,
      code: code.toUpperCase(),
      config,
      is_public: isPublic,
      created_by: user.id,
    })

    if (dbError) {
      setError(dbError.message)
      setLoading(false)
    } else {
      router.push('/countries')
      router.refresh()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Country Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Country Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Philippines"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              ISO Country Code (3 letters)
            </label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g., PHL"
              maxLength={3}
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPublic"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="isPublic" className="text-xs text-gray-700">
              Make this country publicly viewable
            </label>
          </div>

          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadPhilippinesTemplate}
            >
              Load Philippines Template
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Administrative Levels</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addAdminLevel}
            >
              + Add Level
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {adminLevels.map((level, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded p-3 space-y-2"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-700">
                  Adm{level.level} {level.level === 0 && '(Country)'}
                </span>
                {adminLevels.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAdminLevel(index)}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Level Name
                </label>
                <Input
                  value={level.name}
                  onChange={(e) =>
                    updateAdminLevel(index, 'name', e.target.value)
                  }
                  placeholder="e.g., Province"
                  size="sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Pcode Pattern
                  <span className="text-gray-400 ml-1">(optional, for validation)</span>
                </label>
                <Input
                  value={level.pcodePattern}
                  onChange={(e) =>
                    updateAdminLevel(index, 'pcodePattern', e.target.value)
                  }
                  placeholder="e.g., ^[0-9]{2}$ or leave empty"
                  size="sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Examples: <code className="bg-gray-100 px-1">^[0-9]{2}$</code> (2 digits),{' '}
                  <code className="bg-gray-100 px-1">^PHL$</code> (exact match), or leave empty
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={loading} className="flex-1">
          {loading ? 'Creating...' : 'Create Country'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

