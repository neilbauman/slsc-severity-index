import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { calculateSeverity } from '@/lib/processing/severity-calculator'
import { CalculationModelConfig } from '@/lib/processing/ssc-template-parser'

export const runtime = 'nodejs'

/**
 * POST - Run severity calculation
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

    const body = await request.json()
    const {
      country_id,
      calculation_model_id,
      household_dataset_id,
      options = {},
    } = body

    if (!country_id || !calculation_model_id || !household_dataset_id) {
      return NextResponse.json(
        { error: 'Missing required fields: country_id, calculation_model_id, household_dataset_id' },
        { status: 400 }
      )
    }

    // Fetch calculation model
    const { data: model, error: modelError } = await serviceRoleSupabase
      .from('calculation_models')
      .select('*')
      .eq('id', calculation_model_id)
      .single()

    if (modelError || !model) {
      return NextResponse.json(
        { error: 'Calculation model not found' },
        { status: 404 }
      )
    }

    const modelConfig = model.model_config as CalculationModelConfig

    // Fetch household dataset
    const { data: householdDataset, error: datasetError } = await serviceRoleSupabase
      .from('household_datasets')
      .select('*')
      .eq('id', household_dataset_id)
      .single()

    if (datasetError || !householdDataset) {
      return NextResponse.json(
        { error: 'Household dataset not found' },
        { status: 404 }
      )
    }

    // Fetch household records
    const { data: householdRecords, error: recordsError } = await serviceRoleSupabase
      .from('household_records')
      .select('*')
      .eq('household_dataset_id', household_dataset_id)

    if (recordsError) {
      return NextResponse.json(
        { error: `Failed to fetch household records: ${recordsError.message}` },
        { status: 500 }
      )
    }

    if (!householdRecords || householdRecords.length === 0) {
      return NextResponse.json(
        { error: 'No household records found in dataset' },
        { status: 400 }
      )
    }

    // Convert household records to format expected by calculator
    const households = householdRecords.map(record => ({
      household_id: record.household_id || undefined,
      pcode: record.pcode || '',
      admin1: undefined,
      admin2: undefined,
      admin3: undefined,
      admin1_pcode: undefined,
      admin2_pcode: undefined,
      admin3_pcode: undefined,
      population_group: record.population_group || undefined,
      survey_responses: record.survey_responses as Record<string, any>,
    }))

    // Fetch admin boundaries for the country
    const { data: boundaries } = await serviceRoleSupabase
      .from('admin_boundaries')
      .select('id, pcode, name, level')
      .eq('country_id', country_id)

    const adminBoundaries = (boundaries || []).map(b => ({
      id: b.id,
      pcode: b.pcode || '',
      name: b.name,
      level: b.level,
    }))

    // Fetch population data if provided
    let populationData: Array<{ pcode: string; population: number; population_group?: string }> | undefined
    if (options.population_dataset_id) {
      // TODO: Fetch population data from dataset
      // For now, we'll skip this and calculate without population data
    }

    // Create calculation record
    const { data: calculation, error: calcError } = await serviceRoleSupabase
      .from('severity_calculations')
      .insert({
        country_id,
        calculation_model_id,
        household_dataset_id,
        model_config: {
          model: model.name,
          model_version: model.version,
          ...modelConfig,
        },
        status: 'running',
        created_by: user.id,
      })
      .select()
      .single()

    if (calcError || !calculation) {
      return NextResponse.json(
        { error: `Failed to create calculation record: ${calcError?.message}` },
        { status: 500 }
      )
    }

    try {
      // Run calculation
      const result = await calculateSeverity(households, modelConfig, {
        adminBoundaries,
        populationData,
        populationGroups: options.population_groups || undefined,
      })

      // Update household records with calculated scores
      const updates: Promise<any>[] = []
      for (const householdSeverity of result.householdSeverities) {
        const householdRecord = householdRecords.find(
          r => (r.household_id && r.household_id === householdSeverity.household_id) ||
               (r.pcode === householdSeverity.pcode)
        )

        if (householdRecord) {
          updates.push(
            serviceRoleSupabase
              .from('household_records')
              .update({
                pillar1_score: householdSeverity.pillarScores.pillar1,
                pillar2_score: householdSeverity.pillarScores.pillar2,
                pillar3_score: householdSeverity.pillarScores.pillar3,
                final_severity: householdSeverity.finalSeverity,
                calculation_id: calculation.id,
                calculated_at: new Date().toISOString(),
              })
              .eq('id', householdRecord.id)
          )
        }
      }

      // Execute updates in batches
      const batchSize = 100
      for (let i = 0; i < updates.length; i += batchSize) {
        await Promise.all(updates.slice(i, i + batchSize))
      }

      // Create PIN results for each area
      const pinResultsInserts = result.areaSeverities.map(area => ({
        calculation_id: calculation.id,
        admin_boundary_id: area.admin_boundary_id || null,
        severity_level: area.area_severity === 5 ? 'critical' :
                       area.area_severity === 4 ? 'severe' :
                       area.area_severity === 3 ? 'moderate' : 'minimal',
        pin_count: area.pin_count,
        breakdown: {
          total_households: area.total_households,
          severity_distribution: area.severity_distribution,
          severity_proportions: area.severity_proportions,
          area_severity: area.area_severity,
          population_group: area.population_group,
        },
      }))

      // Insert PIN results
      if (pinResultsInserts.length > 0) {
        const { error: pinError } = await serviceRoleSupabase
          .from('pin_results')
          .insert(pinResultsInserts)

        if (pinError) {
          console.error('Error inserting PIN results:', pinError)
          // Continue - calculation still succeeded
        }
      }

      // Update calculation record with results
      const { error: updateError } = await serviceRoleSupabase
        .from('severity_calculations')
        .update({
          status: 'complete',
          results: {
            summary: result.summary,
            total_households: result.householdSeverities.length,
            total_areas: result.areaSeverities.length,
          },
        })
        .eq('id', calculation.id)

      if (updateError) {
        console.error('Error updating calculation results:', updateError)
      }

      return NextResponse.json({
        success: true,
        calculation: {
          ...calculation,
          status: 'complete',
          results: {
            summary: result.summary,
            total_households: result.householdSeverities.length,
            total_areas: result.areaSeverities.length,
          },
        },
        result: {
          summary: result.summary,
          total_households: result.householdSeverities.length,
          total_areas: result.areaSeverities.length,
        },
      })

    } catch (calculationError: any) {
      // Update calculation record with error status
      await serviceRoleSupabase
        .from('severity_calculations')
        .update({
          status: 'error',
          results: {
            error: calculationError.message,
          },
        })
        .eq('id', calculation.id)

      return NextResponse.json(
        { error: `Calculation failed: ${calculationError.message}` },
        { status: 500 }
      )
    }

  } catch (error: any) {
    console.error('Run calculation API error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to run calculation' },
      { status: 500 }
    )
  }
}

