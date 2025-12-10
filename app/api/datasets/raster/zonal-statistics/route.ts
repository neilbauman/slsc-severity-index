import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { calculateZonalStatistics } from '@/lib/processing/raster-processor'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes for large rasters

/**
 * POST /api/datasets/raster/zonal-statistics
 * Calculate population per admin boundary from a GeoTIFF raster
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
        { error: 'Server configuration error' },
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

    const { datasetId, countryId, adminLevel } = await request.json()

    if (!datasetId || !countryId || adminLevel === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: datasetId, countryId, adminLevel' },
        { status: 400 }
      )
    }

    // Fetch dataset
    const { data: dataset, error: datasetError } = await serviceRoleSupabase
      .from('datasets')
      .select('*')
      .eq('id', datasetId)
      .single()

    if (datasetError || !dataset) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
    }

    if (!dataset.file_path) {
      return NextResponse.json(
        { error: 'Dataset has no file' },
        { status: 400 }
      )
    }

    // Check if it's a GeoTIFF
    const fileExtension = dataset.file_path.split('.').pop()?.toLowerCase()
    if (!['tif', 'tiff', 'geotiff'].includes(fileExtension || '')) {
      return NextResponse.json(
        { error: 'Dataset is not a GeoTIFF file' },
        { status: 400 }
      )
    }

    // Download GeoTIFF file
    const { data: fileData, error: fileError } = await serviceRoleSupabase.storage
      .from('datasets')
      .download(dataset.file_path)

    if (fileError || !fileData) {
      return NextResponse.json(
        { error: 'Failed to download raster file' },
        { status: 500 }
      )
    }

    // Fetch admin boundaries for the specified level
    const { data: boundaries, error: boundariesError } = await serviceRoleSupabase
      .from('admin_boundaries')
      .select('id, name, pcode, level, geometry')
      .eq('country_id', countryId)
      .eq('level', adminLevel)
      .not('pcode', 'is', null)

    if (boundariesError || !boundaries) {
      return NextResponse.json(
        { error: 'Failed to fetch admin boundaries' },
        { status: 500 }
      )
    }

    // Convert boundaries to format expected by zonal statistics
    const adminBoundaries = boundaries.map((b: any) => ({
      pcode: b.pcode,
      name: b.name,
      level: b.level,
      geometry: b.geometry, // Already in GeoJSON format
    }))

    // Calculate zonal statistics
    const fileBuffer = await fileData.arrayBuffer()
    const stats = await calculateZonalStatistics(fileBuffer, adminBoundaries)

    // Update dataset metadata with zonal statistics
    const metadata = (dataset.metadata as any) || {}
    metadata.zonalStatistics = {
      adminLevel,
      calculatedAt: new Date().toISOString(),
      totalBoundaries: stats.length,
      totalPopulation: stats.reduce((sum, s) => sum + s.population, 0),
    }

    await serviceRoleSupabase
      .from('datasets')
      .update({ metadata })
      .eq('id', datasetId)

    return NextResponse.json({
      success: true,
      statistics: stats,
      summary: {
        totalBoundaries: stats.length,
        totalPopulation: stats.reduce((sum, s) => sum + s.population, 0),
        boundariesWithPopulation: stats.filter(s => s.population > 0).length,
      },
    })

  } catch (error: any) {
    console.error('Zonal statistics error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to calculate zonal statistics' },
      { status: 500 }
    )
  }
}

