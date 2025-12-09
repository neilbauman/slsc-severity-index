import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * DELETE - Delete all admin boundaries for a country
 */
export async function DELETE(request: Request) {
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

    const { searchParams } = new URL(request.url)
    const countryId = searchParams.get('country_id')

    if (!countryId) {
      return NextResponse.json(
        { error: 'country_id parameter is required' },
        { status: 400 }
      )
    }

    // Delete all admin boundaries for this country
    const { data, error } = await serviceRoleSupabase
      .from('admin_boundaries')
      .delete()
      .eq('country_id', countryId)
      .select()

    if (error) {
      console.error('Error deleting admin boundaries:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Deleted ${data?.length || 0} admin boundary records`,
      deletedCount: data?.length || 0,
    })

  } catch (error: any) {
    console.error('Delete admin boundaries API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete admin boundaries' },
      { status: 500 }
    )
  }
}

