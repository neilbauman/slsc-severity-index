import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { analyzeAdminBoundariesQuality } from '@/lib/processing/data-quality'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const countryId = searchParams.get('countryId')

    if (!countryId) {
      return NextResponse.json({ error: 'countryId is required' }, { status: 400 })
    }

    // Create service role client for analysis
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server configuration error' },
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

    const qualityReport = await analyzeAdminBoundariesQuality(serviceRoleSupabase, countryId)

    return NextResponse.json({ qualityReport })
  } catch (error: any) {
    console.error('Quality analysis error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to analyze data quality' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { countryId, action, issueType, affectedIds } = body

    if (!countryId || !action) {
      return NextResponse.json({ error: 'countryId and action are required' }, { status: 400 })
    }

    // Create service role client for cleaning operations
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server configuration error' },
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

    let result: any = { success: true, message: '' }

    switch (action) {
      case 'delete_duplicates':
        // Delete duplicate boundaries, keeping the first one
        if (!affectedIds || !Array.isArray(affectedIds) || affectedIds.length === 0) {
          return NextResponse.json({ error: 'affectedIds array is required' }, { status: 400 })
        }
        
        // Keep the first ID, delete the rest
        const idsToDelete = affectedIds.slice(1)
        const { error: deleteError } = await serviceRoleSupabase
          .from('admin_boundaries')
          .delete()
          .in('id', idsToDelete)
        
        if (deleteError) {
          throw new Error(`Failed to delete duplicates: ${deleteError.message}`)
        }
        
        result.message = `Deleted ${idsToDelete.length} duplicate boundaries`
        break

      case 'delete_invalid':
        // Delete boundaries with invalid data (missing geometry, invalid parent levels, etc.)
        if (!affectedIds || !Array.isArray(affectedIds) || affectedIds.length === 0) {
          return NextResponse.json({ error: 'affectedIds array is required' }, { status: 400 })
        }
        
        const { error: invalidDeleteError } = await serviceRoleSupabase
          .from('admin_boundaries')
          .delete()
          .in('id', affectedIds)
        
        if (invalidDeleteError) {
          throw new Error(`Failed to delete invalid boundaries: ${invalidDeleteError.message}`)
        }
        
        result.message = `Deleted ${affectedIds.length} invalid boundaries`
        break

      case 'fix_orphaned':
        // Try to fix orphaned boundaries by finding their parents
        if (!issueType || issueType !== 'orphaned_boundary') {
          return NextResponse.json({ error: 'Invalid action for this issue type' }, { status: 400 })
        }
        
        // This would require more complex logic to find and assign parents
        // For now, just return a message that manual review is needed
        result.message = 'Orphaned boundaries require manual review. Please check parent relationships in your source data.'
        result.requiresManualReview = true
        break

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    // Re-run quality analysis to get updated report
    const qualityReport = await analyzeAdminBoundariesQuality(serviceRoleSupabase, countryId)

    return NextResponse.json({
      ...result,
      qualityReport
    })
  } catch (error: any) {
    console.error('Cleaning action error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to perform cleaning action' },
      { status: 500 }
    )
  }
}

