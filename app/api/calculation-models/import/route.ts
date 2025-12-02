import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { parseSSCTemplate, validateCalculationModelConfig } from '@/lib/processing/ssc-template-parser'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST - Import calculation model from Excel template
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

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File
    const countryId = formData.get('country_id') as string | null
    const name = formData.get('name') as string | null
    const version = formData.get('version') as string | null
    const description = formData.get('description') as string | null
    const context = formData.get('context') as string | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Validate file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase()
    if (fileExtension !== 'xlsx' && fileExtension !== 'xls') {
      return NextResponse.json(
        { error: 'Invalid file type. Only Excel files (.xlsx, .xls) are supported.' },
        { status: 400 }
      )
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()

    // Parse Excel template
    let modelConfig
    try {
      modelConfig = await parseSSCTemplate(
        arrayBuffer,
        {
          name: name || undefined,
          version: version || undefined,
          description: description || undefined,
          country: countryId ? undefined : undefined, // Will be set from country lookup if needed
          context: context || undefined,
        }
      )
    } catch (error: any) {
      return NextResponse.json(
        { error: `Failed to parse Excel template: ${error.message}` },
        { status: 400 }
      )
    }

    // Validate parsed config
    const validation = validateCalculationModelConfig(modelConfig)
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Invalid calculation model configuration',
          errors: validation.errors,
          warnings: validation.warnings,
        },
        { status: 400 }
      )
    }

    // Upload file to storage (optional - for reference)
    let filePath: string | null = null
    try {
      const fileName = `calculation-models/${Date.now()}_${file.name}`
      const { data: uploadData, error: uploadError } = await serviceRoleSupabase.storage
        .from('datasets')
        .upload(fileName, arrayBuffer, {
          contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        })

      if (!uploadError && uploadData) {
        filePath = uploadData.path
      }
    } catch (error) {
      console.warn('Failed to upload source file to storage:', error)
      // Continue without storing file - not critical
    }

    // Check for duplicate name/version combination
    if (countryId) {
      const { data: existing } = await serviceRoleSupabase
        .from('calculation_models')
        .select('id')
        .eq('name', modelConfig.name)
        .eq('version', modelConfig.version)
        .eq('country_id', countryId)
        .single()

      if (existing) {
        return NextResponse.json(
          { error: 'Calculation model with this name, version, and country already exists' },
          { status: 409 }
        )
      }
    }

    // Insert calculation model
    const { data: model, error: insertError } = await serviceRoleSupabase
      .from('calculation_models')
      .insert({
        name: modelConfig.name,
        version: modelConfig.version,
        description: modelConfig.description || description || null,
        country_id: countryId || null,
        model_config: modelConfig,
        source_file_path: filePath,
        source_metadata: {
          originalFileName: file.name,
          fileSize: file.size,
          ...modelConfig.metadata,
        },
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
      validation: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
    })

  } catch (error: any) {
    console.error('Import calculation model API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to import calculation model' },
      { status: 500 }
    )
  }
}

