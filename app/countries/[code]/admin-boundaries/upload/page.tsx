import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { BoundaryUploadForm } from '@/components/admin-boundaries/boundary-upload-form'

export default async function UploadBoundariesPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const supabase = await createClient()

  const { data: country } = await supabase
    .from('countries')
    .select('*')
    .eq('code', code.toUpperCase())
    .single()

  if (!country) {
    notFound()
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const config = country.config as any

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link
              href={`/countries/${code}/admin-boundaries`}
              className="text-sm font-semibold text-gray-900"
            >
              ← Admin Boundaries
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">
              Upload Boundaries
            </h1>
            <div></div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-3xl">
        <BoundaryUploadForm countryId={country.id} countryCode={code} config={config} />
      </main>
    </div>
  )
}

