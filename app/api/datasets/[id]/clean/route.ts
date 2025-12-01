import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { analyzeDatasetQuality } from '@/lib/processing/dataset-quality'

export const runtime = 'nodejs'

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

    const { action, createBackup = true } = await request.json()

    if (!action || !action.type) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Fetch dataset
    const { data: dataset, error: datasetError } = await serviceRoleSupabase
      .from('datasets')
      .select('*')
      .eq('id', id)
      .single()

    if (datasetError || !dataset) {
      return NextResponse.json(
        { error: 'Dataset not found' },
        { status: 404 }
      )
    }

    // Create backup before cleaning if requested
    let versionBefore: string | null = null
    if (createBackup) {
      // Get current version number
      const { data: versions } = await serviceRoleSupabase
        .from('dataset_versions')
        .select('version_number')
        .eq('dataset_id', id)
        .order('version_number', { ascending: false })
        .limit(1)

      const nextVersion = versions && versions.length > 0
        ? versions[0].version_number + 1
        : 1

      // Create backup by copying file
      if (dataset.file_path) {
        const { data: fileData } = await serviceRoleSupabase.storage
          .from('datasets')
          .download(dataset.file_path)

        if (fileData) {
          const backupPath = `${dataset.file_path.replace(/\.(csv|json|geojson|xlsx)$/, '')}_v${nextVersion}.${dataset.file_path.split('.').pop()}`
          
          const fileBuffer = await fileData.arrayBuffer()
          const { data: uploadData, error: uploadError } = await serviceRoleSupabase.storage
            .from('datasets')
            .upload(backupPath, fileBuffer, {
              cacheControl: '3600',
              upsert: false
            })

          if (!uploadError) {
            const { data: versionData, error: versionError } = await serviceRoleSupabase
              .from('dataset_versions')
              .insert({
                dataset_id: id,
                version_number: nextVersion,
                description: `Backup before ${action.type} cleaning`,
                file_path: backupPath,
                metadata: {
                  action: action.type,
                  created_by: user.id,
                },
                created_by: user.id,
              })
              .select('id')
              .single()

            if (!versionError && versionData) {
              versionBefore = versionData.id
            }
          }
        }
      }
    }

    // Perform cleaning action
    let fixedCount = 0
    let errors: string[] = []

    switch (action.type) {
      case 'remove_duplicates':
        // This would require reading, processing, and re-uploading the file
        // For now, return a placeholder
        fixedCount = 0
        errors.push('Duplicate removal not yet implemented - requires file processing')
        break

      case 'fix_negative_values':
        // Similar placeholder
        fixedCount = 0
        errors.push('Negative value fixing not yet implemented - requires file processing')
        break

      default:
        errors.push(`Unknown action type: ${action.type}`)
    }

    // Record cleaning history
    if (versionBefore) {
      await serviceRoleSupabase
        .from('dataset_cleaning_history')
        .insert({
          dataset_id: id,
          version_before: versionBefore,
          action_type: action.type,
          action_details: action,
          affected_rows: fixedCount,
          created_by: user.id,
        })
    }

    // Re-analyze quality after cleaning
    const qualityReport = await analyzeDatasetQuality(serviceRoleSupabase, id)

    return NextResponse.json({
      success: true,
      fixedCount,
      errors,
      versionBefore,
      qualityReport,
    })

  } catch (error: any) {
    console.error('Dataset cleaning error:', error)
    return NextResponse.json(
      { error: error.message || 'Cleaning failed' },
      { status: 500 }
    )
  }
}

