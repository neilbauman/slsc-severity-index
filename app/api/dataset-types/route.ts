import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET - List all dataset types
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: datasetTypes, error } = await supabase
      .from('dataset_types')
      .select('*')
      .order('name', { ascending: true })

    if (error) {
      console.error('Error fetching dataset types:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      datasetTypes: datasetTypes || [],
    })

  } catch (error: any) {
    console.error('Dataset types API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch dataset types' },
      { status: 500 }
    )
  }
}

