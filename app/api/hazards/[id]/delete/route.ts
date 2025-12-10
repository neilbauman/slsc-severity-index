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

    // Fetch hazard to check ownership
    const { data: hazard, error: fetchError } = await serviceRoleSupabase
      .from('hazards')
      .select('uploaded_by')
      .eq('id', id)
      .single()

    if (fetchError || !hazard) {
      return NextResponse.json(
        { error: 'Hazard not found' },
        { status: 404 }
      )
    }

    // Check if user owns the hazard or is admin
    if (hazard.uploaded_by !== user.id) {
      return NextResponse.json(
        { error: 'You can only delete hazards you uploaded' },
        { status: 403 }
      )
    }

    // Delete hazard record (cascade will handle related records if any)
    const { error: deleteError } = await serviceRoleSupabase
      .from('hazards')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete hazard: ${deleteError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Hazard deleted successfully',
    })

  } catch (error: any) {
    console.error('Delete hazard error:', error)
    return NextResponse.json(
      { error: error.message || 'Delete failed' },
      { status: 500 }
    )
  }
}

