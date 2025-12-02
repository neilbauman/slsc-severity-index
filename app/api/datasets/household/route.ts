import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET - List household datasets
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const countryId = searchParams.get('country_id')

    if (!countryId) {
      return NextResponse.json(
        { error: 'country_id parameter is required' },
        { status: 400 }
      )
    }

    const { data: datasets, error } = await supabase
      .from('household_datasets')
      .select('*')
      .eq('country_id', countryId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching household datasets:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ datasets: datasets || [] })

  } catch (error: any) {
    console.error('Household datasets API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch household datasets' },
      { status: 500 }
    )
  }
}

