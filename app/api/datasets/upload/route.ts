import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server configuration error: Service role key not configured' },
        { status: 500 }
      )
    }

    const serviceRoleSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { countryId, datasetName, filePath } = await request.json()

    if (!countryId || !datasetName || !filePath) {
      return NextResponse.json(
        { error: 'Missing required fields: countryId, datasetName, filePath' },
        { status: 400 }
      )
    }

    // Create dataset record using service role client (bypasses RLS)
    const { data: dataset, error: datasetError } = await serviceRoleSupabase
      .from('datasets')
      .insert({
        country_id: countryId,
        name: datasetName,
        file_path: filePath,
        status: 'processing',
        uploaded_by: user.id,
      })
      .select()
      .single()

    if (datasetError) {
      console.error('Dataset insert error:', datasetError)
      return NextResponse.json(
        { error: `Failed to create dataset record: ${datasetError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      dataset,
    })

  } catch (error: any) {
    console.error('Dataset upload API error:', error)
    return NextResponse.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    )
  }
}

