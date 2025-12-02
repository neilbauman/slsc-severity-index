import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

/**
 * POST - Execute SQL migration
 * Note: This requires the SQL to be executed directly via Supabase dashboard
 * or we need a database function to execute it
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { sql } = body

    if (!sql) {
      return NextResponse.json(
        { error: 'SQL is required' },
        { status: 400 }
      )
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server configuration error: Service role key not configured' },
        { status: 500 }
      )
    }

    // Note: Supabase JS client doesn't support raw DDL execution
    // We need to use the REST API or create a database function
    // For now, return the SQL to be executed manually or via dashboard
    
    return NextResponse.json({
      success: false,
      message: 'Direct SQL execution requires Supabase database access. Please execute the migration SQL in your Supabase SQL Editor.',
      sql: sql,
    })

  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process migration' },
      { status: 500 }
    )
  }
}

/**
 * GET - Get migration SQL file content
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const migrationName = searchParams.get('name')

    if (!migrationName) {
      return NextResponse.json(
        { error: 'Migration name is required' },
        { status: 400 }
      )
    }

    // Read migration file
    try {
      const migrationPath = join(process.cwd(), 'migrations', `${migrationName}.sql`)
      const migrationSQL = readFileSync(migrationPath, 'utf-8')

      return NextResponse.json({
        success: true,
        name: migrationName,
        sql: migrationSQL,
      })
    } catch (error: any) {
      return NextResponse.json(
        { error: `Migration file not found: ${migrationName}.sql` },
        { status: 404 }
      )
    }

  } catch (error: any) {
    console.error('Migration error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to load migration' },
      { status: 500 }
    )
  }
}
