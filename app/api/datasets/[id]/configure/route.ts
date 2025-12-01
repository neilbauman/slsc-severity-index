import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

    const { metadata } = await request.json()

    // Fetch existing dataset to merge metadata
    const { data: existingDataset, error: fetchError } = await serviceRoleSupabase
      .from('datasets')
      .select('metadata')
      .eq('id', id)
      .single()

    if (fetchError || !existingDataset) {
      return NextResponse.json(
        { error: 'Dataset not found' },
        { status: 404 }
      )
    }

    // Merge with existing metadata
    const existingMetadata = (existingDataset.metadata as any) || {}
    const updatedMetadata = {
      ...existingMetadata,
      ...metadata,
      columns: {
        ...existingMetadata.columns,
        ...metadata.columns,
      },
    }

    // Update dataset metadata
    const { error: updateError } = await serviceRoleSupabase
      .from('datasets')
      .update({
        metadata: updatedMetadata,
      })
      .eq('id', id)

    if (updateError) {
      console.error('Dataset update error:', updateError)
      return NextResponse.json(
        { error: `Failed to update dataset: ${updateError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      metadata: updatedMetadata,
    })

  } catch (error: any) {
    console.error('Dataset configuration API error:', error)
    return NextResponse.json(
      { error: error.message || 'Configuration failed' },
      { status: 500 }
    )
  }
}

