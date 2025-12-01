import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function DELETE(
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

    // Fetch dataset to get file_path
    const { data: dataset, error: fetchError } = await serviceRoleSupabase
      .from('datasets')
      .select('file_path, uploaded_by')
      .eq('id', id)
      .single()

    if (fetchError || !dataset) {
      return NextResponse.json(
        { error: 'Dataset not found' },
        { status: 404 }
      )
    }

    // Check if user owns the dataset or is admin
    if (dataset.uploaded_by !== user.id) {
      return NextResponse.json(
        { error: 'You can only delete datasets you uploaded' },
        { status: 403 }
      )
    }

    // Delete file from storage if it exists
    if (dataset.file_path) {
      await serviceRoleSupabase.storage
        .from('datasets')
        .remove([dataset.file_path])
    }

    // Delete dataset record
    const { error: deleteError } = await serviceRoleSupabase
      .from('datasets')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete dataset: ${deleteError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Dataset deleted successfully',
    })

  } catch (error: any) {
    console.error('Delete dataset error:', error)
    return NextResponse.json(
      { error: error.message || 'Delete failed' },
      { status: 500 }
    )
  }
}

