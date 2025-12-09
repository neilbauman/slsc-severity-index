import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET - Get a signed upload URL for direct client-side upload to Supabase Storage
 * This bypasses server-side body size limits
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const countryId = searchParams.get('country_id')
    const fileName = searchParams.get('file_name')

    if (!countryId || !fileName) {
      return NextResponse.json(
        { error: 'country_id and file_name parameters are required' },
        { status: 400 }
      )
    }

    // Generate unique file path
    const timestamp = Date.now()
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = `${countryId}/${timestamp}-${safeFileName}`

    // Create signed URL for upload (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from('admin-boundaries')
      .createSignedUploadUrl(filePath)

    if (error) {
      console.error('Error creating signed upload URL:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      uploadUrl: data.signedUrl,
      path: data.path,
      token: data.token
    })

  } catch (error: any) {
    console.error('Get upload URL API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get upload URL' },
      { status: 500 }
    )
  }
}

