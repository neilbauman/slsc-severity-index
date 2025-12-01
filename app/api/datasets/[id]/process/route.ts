import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { processExcelFile, validateExcelData } from '@/lib/processing/excel-processor'
import { processCSVFile, validateCSVData } from '@/lib/processing/csv-processor'

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

    if (!dataset.file_path) {
      return NextResponse.json(
        { error: 'Dataset has no file path' },
        { status: 400 }
      )
    }

    // Download file from storage
    const { data: fileData, error: fileError } = await serviceRoleSupabase.storage
      .from('datasets')
      .download(dataset.file_path)

    if (fileError || !fileData) {
      return NextResponse.json(
        { error: 'Failed to download file from storage' },
        { status: 500 }
      )
    }

    // Process file based on extension
    const fileExtension = dataset.file_path.split('.').pop()?.toLowerCase()
    let processingResult: any = null
    let validationResult: any = null

    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
      const fileBuffer = await fileData.arrayBuffer()
      processingResult = await processExcelFile(fileBuffer)
      validationResult = validateExcelData(processingResult)
    } else if (fileExtension === 'csv') {
      const fileText = await fileData.text()
      processingResult = await processCSVFile(fileText)
      validationResult = validateCSVData(processingResult)
    } else {
      return NextResponse.json(
        { error: `File type .${fileExtension} processing not yet implemented. Supported formats: CSV, Excel (.xlsx, .xls)` },
        { status: 400 }
      )
    }

    // Update dataset with processing results
    const { error: updateError } = await serviceRoleSupabase
      .from('datasets')
      .update({
        status: validationResult.valid ? 'complete' : 'error',
        metadata: {
          processingResult,
          validationResult,
          processedAt: new Date().toISOString(),
        },
      })
      .eq('id', id)

    if (updateError) {
      console.error('Failed to update dataset:', updateError)
    }

    return NextResponse.json({
      success: true,
      processingResult,
      validationResult,
    })

  } catch (error: any) {
    console.error('Dataset processing error:', error)
    return NextResponse.json(
      { error: error.message || 'Processing failed' },
      { status: 500 }
    )
  }
}

