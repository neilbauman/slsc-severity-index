import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET - List countries or get by code
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')

    let query = supabase
      .from('countries')
      .select('*')
      .order('name', { ascending: true })

    if (code) {
      query = query.eq('code', code.toUpperCase())
    }

    const { data: countries, error } = await query

    if (error) {
      console.error('Error fetching countries:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ countries: countries || [] })

  } catch (error: any) {
    console.error('Countries API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch countries' },
      { status: 500 }
    )
  }
}

