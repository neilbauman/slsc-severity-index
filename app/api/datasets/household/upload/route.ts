import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { processHouseholdExcel, processHouseholdCSV, validateHouseholdDataset } from '@/lib/processing/household-processor'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST - Upload and process household dataset
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
    const countryId = formData.get('country_id') as string
    const name = formData.get('name') as string
    const description = formData.get('description') as string | null
    const datasetId = formData.get('dataset_id') as string | null

    if (!file || !countryId || !name) {
      return NextResponse.json(
        { error: 'Missing required fields: file, country_id, name' },
        { status: 400 }
      )
    }

    // Validate file type
    const fileExtension = file.name.split('.').pop()?.toLowerCase()
    if (fileExtension !== 'xlsx' && fileExtension !== 'xls' && fileExtension !== 'csv') {
      return NextResponse.json(
        { error: 'Invalid file type. Supported formats: Excel (.xlsx, .xls) or CSV (.csv)' },
        { status: 400 }
      )
    }

    // Upload file to storage first
    const fileName = `household-datasets/${countryId}/${Date.now()}_${file.name}`
    const arrayBuffer = await file.arrayBuffer()

    const { data: uploadData, error: uploadError } = await serviceRoleSupabase.storage
      .from('datasets')
      .upload(fileName, arrayBuffer, {
        contentType: file.type || `application/${fileExtension === 'csv' ? 'csv' : 'vnd.openxmlformats-officedocument.spreadsheetml.sheet'}`,
        upsert: false,
      })

    if (uploadError) {
      console.error('Error uploading file:', uploadError)
      return NextResponse.json(
        { error: `Failed to upload file: ${uploadError.message}` },
        { status: 500 }
      )
    }

    // Process household data
    let processingResult
    if (fileExtension === 'csv') {
      const fileText = new TextDecoder().decode(arrayBuffer)
      processingResult = await processHouseholdCSV(fileText)
    } else {
      processingResult = await processHouseholdExcel(arrayBuffer)
    }

    // Validate processed data
    const validation = validateHouseholdDataset(processingResult)
    if (!validation.valid) {
      // Delete uploaded file if validation fails
      await serviceRoleSupabase.storage
        .from('datasets')
        .remove([uploadData.path])

      return NextResponse.json(
        {
          error: 'Validation failed',
          errors: validation.errors,
          warnings: validation.warnings,
        },
        { status: 400 }
      )
    }

    // Create household dataset record
    const { data: householdDataset, error: datasetError } = await serviceRoleSupabase
      .from('household_datasets')
      .insert({
        country_id: countryId,
        dataset_id: datasetId || null,
        name,
        description: description || null,
        file_path: uploadData.path,
        total_households: processingResult.totalRecords,
        status: 'processing',
        metadata: {
          detectedFields: processingResult.detectedFields,
          validation: {
            errors: validation.errors,
            warnings: validation.warnings,
          },
        },
        uploaded_by: user.id,
      })
      .select()
      .single()

    if (datasetError) {
      console.error('Error creating household dataset:', datasetError)
      // Delete uploaded file
      await serviceRoleSupabase.storage
        .from('datasets')
        .remove([uploadData.path])

      return NextResponse.json(
        { error: datasetError.message },
        { status: 500 }
      )
    }

    // Link households to admin boundaries and store records
    let matchedCount = 0
    const boundaryCache = new Map<string, string | null>()

    // Batch insert household records
    const batchSize = 1000
    const records = processingResult.records

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize)

      // Resolve admin boundary IDs for this batch
      const pcodes = batch.map(r => r.pcode).filter(Boolean) as string[]
      const uniquePcodes = [...new Set(pcodes)]

      if (uniquePcodes.length > 0) {
        const { data: boundaries } = await serviceRoleSupabase
          .from('admin_boundaries')
          .select('id, pcode')
          .eq('country_id', countryId)
          .in('pcode', uniquePcodes)

        for (const boundary of boundaries || []) {
          boundaryCache.set(boundary.pcode, boundary.id)
        }
      }

      // Prepare household records for insertion
      const householdRecords = batch.map(record => {
        const adminBoundaryId = record.pcode ? boundaryCache.get(record.pcode) || null : null
        if (adminBoundaryId) {
          matchedCount++
        }

        return {
          household_dataset_id: householdDataset.id,
          admin_boundary_id: adminBoundaryId,
          pcode: record.pcode || null,
          household_id: record.household_id || null,
          survey_responses: record.survey_responses,
          population_group: record.population_group || null,
        }
      })

      // Insert batch
      const { error: insertError } = await serviceRoleSupabase
        .from('household_records')
        .insert(householdRecords)

      if (insertError) {
        console.error('Error inserting household records batch:', insertError)
        // Continue with other batches
      }
    }

    // Update household dataset with final status
    const { error: updateError } = await serviceRoleSupabase
      .from('household_datasets')
      .update({
        status: 'complete',
        metadata: {
          ...householdDataset.metadata,
          matchedBoundaries: matchedCount,
          unmatchedPcodes: processingResult.unmatchedPcodes,
        },
        processed_at: new Date().toISOString(),
      })
      .eq('id', householdDataset.id)

    if (updateError) {
      console.error('Error updating household dataset status:', updateError)
    }

    return NextResponse.json({
      success: true,
      householdDataset: {
        ...householdDataset,
        status: 'complete',
      },
      processingResult: {
        totalRecords: processingResult.totalRecords,
        matchedBoundaries: matchedCount,
        unmatchedPcodes: processingResult.unmatchedPcodes.length,
      },
      validation: {
        errors: validation.errors,
        warnings: validation.warnings,
      },
    })

  } catch (error: any) {
    console.error('Household dataset upload API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to upload household dataset' },
      { status: 500 }
    )
  }
}

