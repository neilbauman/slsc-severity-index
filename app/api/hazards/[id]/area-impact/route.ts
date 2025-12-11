import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

/**
 * POST /api/hazards/[id]/area-impact
 * Calculate the percentage of each admin area affected by the hazard
 */
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

    const { adminLevel } = await request.json()

    console.log(`[Area Impact API] Starting area impact analysis for hazard ${id} at admin level ${adminLevel}`)

    // Fetch hazard
    const { data: hazard, error: hazardError } = await serviceRoleSupabase
      .from('hazards')
      .select('*, country_id')
      .eq('id', id)
      .single()

    if (hazardError || !hazard) {
      console.error('[Area Impact API] Hazard not found:', hazardError)
      return NextResponse.json({ error: 'Hazard not found' }, { status: 404 })
    }

    console.log('[Area Impact API] Hazard fetched:', hazard.name, hazard.type)

    // Use PostGIS function to calculate intersection areas
    const { data: areaImpact, error: rpcError } = await serviceRoleSupabase.rpc('calculate_hazard_area_impact', {
      p_hazard_id: id,
      p_admin_level: adminLevel !== null && adminLevel !== undefined ? adminLevel : null,
    })

    if (rpcError) {
      // If function doesn't exist, suggest running the migration
      if (rpcError.message?.includes('function') && rpcError.message?.includes('does not exist')) {
        return NextResponse.json(
          { 
            error: 'Database function not found. Please run the migration "create_hazard_area_impact_function.sql" in your Supabase SQL editor.',
            requiresMigration: true,
            migrationName: 'create_hazard_area_impact_function',
          },
          { status: 400 }
        )
      }
      
      console.error('[Area Impact API] RPC error:', rpcError)
      return NextResponse.json(
        { error: `Failed to calculate area impact: ${rpcError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      hazard: {
        id: hazard.id,
        name: hazard.name,
        type: hazard.type,
      },
      adminLevel: adminLevel !== null && adminLevel !== undefined ? adminLevel : 'all',
      results: areaImpact || [],
      calculatedAt: new Date().toISOString(),
    })

  } catch (error: any) {
    console.error('Hazard area impact analysis error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to analyze hazard area impact' },
      { status: 500 }
    )
  }
}

