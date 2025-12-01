import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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

    const { versionId } = await request.json()

    if (!versionId) {
      return NextResponse.json({ error: 'Version ID required' }, { status: 400 })
    }

    // Fetch version
    const { data: version, error: versionError } = await serviceRoleSupabase
      .from('dataset_versions')
      .select('*')
      .eq('id', versionId)
      .eq('dataset_id', id)
      .single()

    if (versionError || !version) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 }
      )
    }

    // Fetch current dataset
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

    // Create backup of current version before reverting
    const { data: currentVersions } = await serviceRoleSupabase
      .from('dataset_versions')
      .select('version_number')
      .eq('dataset_id', id)
      .order('version_number', { ascending: false })
      .limit(1)

    const nextVersion = currentVersions && currentVersions.length > 0
      ? currentVersions[0].version_number + 1
      : 1

    if (dataset.file_path) {
      const { data: currentFile } = await serviceRoleSupabase.storage
        .from('datasets')
        .download(dataset.file_path)

      if (currentFile) {
        const backupPath = `${dataset.file_path.replace(/\.(csv|json|geojson|xlsx)$/, '')}_v${nextVersion}_before_revert.${dataset.file_path.split('.').pop()}`
        const fileBuffer = await currentFile.arrayBuffer()

        await serviceRoleSupabase.storage
          .from('datasets')
          .upload(backupPath, fileBuffer, {
            cacheControl: '3600',
            upsert: false
          })

        await serviceRoleSupabase
          .from('dataset_versions')
          .insert({
            dataset_id: id,
            version_number: nextVersion,
            description: `Backup before reverting to version ${version.version_number}`,
            file_path: backupPath,
            metadata: {
              reverted_from: version.id,
              reverted_to: version.version_number,
            },
            created_by: user.id,
          })
      }
    }

    // Restore the version file
    const { data: versionFile, error: fileError } = await serviceRoleSupabase.storage
      .from('datasets')
      .download(version.file_path)

    if (fileError || !versionFile) {
      return NextResponse.json(
        { error: 'Version file not found in storage' },
        { status: 404 }
      )
    }

    // Replace current file with version file
    const fileBuffer = await versionFile.arrayBuffer()
    const { error: replaceError } = await serviceRoleSupabase.storage
      .from('datasets')
      .upload(dataset.file_path, fileBuffer, {
        cacheControl: '3600',
        upsert: true
      })

    if (replaceError) {
      return NextResponse.json(
        { error: `Failed to restore file: ${replaceError.message}` },
        { status: 500 }
      )
    }

    // Record revert in history
    await serviceRoleSupabase
      .from('dataset_cleaning_history')
      .insert({
        dataset_id: id,
        version_before: version.id,
        action_type: 'revert',
        action_details: {
          reverted_to_version: version.version_number,
          description: version.description,
        },
        created_by: user.id,
      })

    return NextResponse.json({
      success: true,
      message: `Successfully reverted to version ${version.version_number}`,
      version: version,
    })

  } catch (error: any) {
    console.error('Revert error:', error)
    return NextResponse.json(
      { error: error.message || 'Revert failed' },
      { status: 500 }
    )
  }
}

