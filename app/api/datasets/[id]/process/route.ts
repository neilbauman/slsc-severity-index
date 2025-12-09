import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { processExcelFile, validateExcelData } from '@/lib/processing/excel-processor'
import { processCSVFile, validateCSVData } from '@/lib/processing/csv-processor'
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
      // Get admin level and pcode column from metadata if available
      const metadata = (dataset.metadata as any) || {}
      const adminLevel = metadata.adminLevel !== undefined ? parseInt(String(metadata.adminLevel), 10) : undefined
      const pcodeColumn = metadata.columns?.pcode
      
      // Check if we should filter to total population only (from metadata or auto-detect)
      const shouldFilterTotalPopulation = metadata.filterTotalPopulationOnly !== undefined
        ? metadata.filterTotalPopulationOnly
        : (dataset.name.toLowerCase().includes('population') ||
           dataset.name.toLowerCase().includes('pop') ||
           (metadata.columns && metadata.columns.population))

      processingResult = await processCSVFile(fileText, {
        filterAdminLevel: !isNaN(adminLevel || NaN) ? adminLevel : undefined,
        pcodeColumn: pcodeColumn || undefined,
        filterTotalPopulationOnly: shouldFilterTotalPopulation,
      })
      validationResult = validateCSVData(processingResult)
    } else {
      return NextResponse.json(
        { error: `File type .${fileExtension} processing not yet implemented. Supported formats: CSV, Excel (.xlsx, .xls)` },
        { status: 400 }
      )
    }

    // Run data quality analysis (includes pcode matching against admin boundaries)
    let qualityReport = null
    try {
      console.log('Running data quality analysis...')
      qualityReport = await analyzeDatasetQuality(serviceRoleSupabase, id, processingResult.rows)
      console.log(`Quality score: ${qualityReport.overallScore}/100, ${qualityReport.issues.length} issues found`)
      
      // Check if there are critical errors that should prevent completion
      const hasErrors = qualityReport.issues.some(issue => issue.severity === 'error')
      
      // Update dataset with processing results and quality report
      const { error: updateError } = await serviceRoleSupabase
        .from('datasets')
        .update({
          status: validationResult.valid && !hasErrors ? 'complete' : 'error',
          metadata: {
            ...dataset.metadata,
            processingResult,
            validationResult,
            qualityReport,
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
        qualityReport,
        status: validationResult.valid && !hasErrors ? 'complete' : 'error',
      })
    } catch (qualityError: any) {
      console.error('Error running quality analysis:', qualityError)
      // Still update with processing results even if quality analysis fails
      const { error: updateError } = await serviceRoleSupabase
        .from('datasets')
        .update({
          status: validationResult.valid ? 'complete' : 'error',
          metadata: {
            ...dataset.metadata,
            processingResult,
            validationResult,
            qualityError: qualityError.message,
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
        qualityError: qualityError.message,
        warning: 'Data quality analysis failed, but basic processing completed',
      })
    }

  } catch (error: any) {
    console.error('Dataset processing error:', error)
    return NextResponse.json(
      { error: error.message || 'Processing failed' },
      { status: 500 }
    )
  }
}

