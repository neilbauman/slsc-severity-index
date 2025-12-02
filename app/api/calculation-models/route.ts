import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * GET - List calculation models
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { searchParams } = new URL(request.url)
    const countryId = searchParams.get('country_id')
    const isActive = searchParams.get('is_active')

    // Check if table exists first (in case migration hasn't been run)
    let query = supabase
      .from('calculation_models')
      .select('*')
      .order('created_at', { ascending: false })

    if (countryId) {
      query = query.eq('country_id', countryId)
    }

    if (isActive !== null) {
      query = query.eq('is_active', isActive === 'true')
    }

    const { data: models, error } = await query

    if (error) {
      // Check if error is due to table not existing
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return NextResponse.json(
          { 
            error: 'Calculation models table does not exist. Please run the database migration first.',
            models: [],
            migrationRequired: true
          },
          { status: 200 } // Return 200 so UI can handle gracefully
        )
      }
      console.error('Error fetching calculation models:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ models })

  } catch (error: any) {
    console.error('Calculation models API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch calculation models' },
      { status: 500 }
    )
  }
}

/**
 * POST - Create a new calculation model manually
 */
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

    const body = await request.json()
    const { name, version, description, country_id, model_config, source_metadata } = body

    if (!name || !version || !model_config) {
      return NextResponse.json(
        { error: 'Missing required fields: name, version, model_config' },
        { status: 400 }
      )
    }

    // Check for duplicate name/version combination
    if (country_id) {
      const { data: existing } = await serviceRoleSupabase
        .from('calculation_models')
        .select('id')
        .eq('name', name)
        .eq('version', version)
        .eq('country_id', country_id)
        .single()

      if (existing) {
        return NextResponse.json(
          { error: 'Calculation model with this name, version, and country already exists' },
          { status: 409 }
        )
      }
    }

    // Insert new calculation model
    const { data: model, error: insertError } = await serviceRoleSupabase
      .from('calculation_models')
      .insert({
        name,
        version,
        description,
        country_id: country_id || null,
        model_config,
        source_metadata: source_metadata || null,
        is_active: true,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating calculation model:', insertError)
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      model,
    })

  } catch (error: any) {
    console.error('Create calculation model API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create calculation model' },
      { status: 500 }
    )
  }
}

