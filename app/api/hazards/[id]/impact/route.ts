import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { extractPixelsInPolygon } from '@/lib/processing/raster-processor'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes

/**
 * POST /api/hazards/[id]/impact
 * Calculate population impact using granular raster overlay or zonal statistics
 */
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

    const { datasetId, analysisType = 'granular' } = await request.json()

    if (!datasetId) {
      return NextResponse.json(
        { error: 'Missing required field: datasetId' },
        { status: 400 }
      )
    }

    // Fetch hazard
    const { data: hazard, error: hazardError } = await serviceRoleSupabase
      .from('hazards')
      .select('*')
      .eq('id', id)
      .single()

    if (hazardError || !hazard) {
      return NextResponse.json({ error: 'Hazard not found' }, { status: 404 })
    }

    // Fetch dataset (should be a GeoTIFF raster)
    const { data: dataset, error: datasetError } = await serviceRoleSupabase
      .from('datasets')
      .select('*')
      .eq('id', datasetId)
      .single()

    if (datasetError || !dataset) {
      return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
    }

    // Download raster file
    if (!dataset.file_path) {
      return NextResponse.json(
        { error: 'Dataset has no file' },
        { status: 400 }
      )
    }

    const { data: fileData, error: fileError } = await serviceRoleSupabase.storage
      .from('datasets')
      .download(dataset.file_path)

    if (fileError || !fileData) {
      return NextResponse.json(
        { error: 'Failed to download raster file' },
        { status: 500 }
      )
    }

    // Get hazard geometry from affected_areas JSONB field (stored during upload)
    const affectedAreas = (hazard.affected_areas as any) || []
    let hazardGeometries: Array<{ type: string; coordinates: any }> = []

    // Extract geometries from affected_areas (stored as GeoJSON during upload)
    if (affectedAreas.length > 0) {
      for (const area of affectedAreas) {
        if (area.geometry && area.geometry.type) {
          hazardGeometries.push(area.geometry)
        }
      }
    }

    if (hazardGeometries.length === 0) {
      return NextResponse.json(
        { error: 'Hazard has no valid geometry in affected_areas. Please ensure the hazard was uploaded with geometry data.' },
        { status: 400 }
      )
    }

    const fileBuffer = await fileData.arrayBuffer()
    let totalAffectedPopulation = 0
    let totalAffectedPixels = 0
    const pixelDetails: Array<{ x: number; y: number; value: number }> = []
    
    // Get raster metadata first to check bounds
    const { extractRasterMetadata } = await import('@/lib/processing/raster-processor')
    let rasterMetadata: any = null
    try {
      rasterMetadata = await extractRasterMetadata(fileBuffer)
      console.log('Raster metadata:', {
        bounds: rasterMetadata.bounds,
        width: rasterMetadata.width,
        height: rasterMetadata.height,
        pixelWidth: rasterMetadata.pixelWidth,
        pixelHeight: rasterMetadata.pixelHeight,
      })
    } catch (err) {
      console.error('Failed to extract raster metadata:', err)
    }

    // Process each geometry in the hazard
    const processingErrors: string[] = []
    for (let i = 0; i < hazardGeometries.length; i++) {
      const geom = hazardGeometries[i]
      if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        try {
          console.log(`Processing geometry ${i + 1}/${hazardGeometries.length}: ${geom.type}`)
          const pixels = await extractPixelsInPolygon(fileBuffer, geom as any)
          console.log(`Found ${pixels.length} pixels for geometry ${i + 1}`)
          
          totalAffectedPixels += pixels.length
          totalAffectedPopulation += pixels.reduce((sum, p) => sum + Math.max(0, p.value), 0)
          
          if (analysisType === 'granular') {
            pixelDetails.push(...pixels)
          }
        } catch (err: any) {
          console.error(`Error processing geometry ${i + 1}:`, err)
          processingErrors.push(`Geometry ${i + 1}: ${err.message || String(err)}`)
        }
      }
    }
    
    // If no pixels found, include diagnostic info
    if (totalAffectedPixels === 0) {
      console.warn('No pixels found. Diagnostic info:', {
        hazardGeometriesCount: hazardGeometries.length,
        rasterMetadata: rasterMetadata ? {
          bounds: rasterMetadata.bounds,
          crs: rasterMetadata.crs,
        } : null,
        processingErrors: processingErrors.length > 0 ? processingErrors : undefined,
      })
    }

    // If zonal statistics exist, also provide admin-level breakdown
    let adminBreakdown: any[] = []
    const metadata = (dataset.metadata as any) || {}
    if (metadata.zonalStatistics && analysisType === 'aggregated') {
      // Use zonal statistics for admin-level analysis
      const { data: boundaries } = await serviceRoleSupabase
        .from('admin_boundaries')
        .select('id, name, pcode, level, geometry')
        .eq('country_id', hazard.country_id)

      // This would require PostGIS ST_Intersects to find boundaries overlapping with hazard
      // For now, return pixel-level results
    }

    return NextResponse.json({
      success: true,
      analysisType,
      hazard: {
        id: hazard.id,
        name: hazard.name,
        type: hazard.type,
      },
      results: {
        totalAffectedPopulation: Math.round(totalAffectedPopulation),
        totalAffectedPixels,
        pixelDetails: analysisType === 'granular' ? pixelDetails.slice(0, 1000) : undefined, // Limit for response size
        adminBreakdown: adminBreakdown.length > 0 ? adminBreakdown : undefined,
      },
      metadata: {
        rasterDataset: dataset.name,
        geometryCount: hazardGeometries.length,
        calculatedAt: new Date().toISOString(),
        rasterBounds: rasterMetadata?.bounds,
        rasterCRS: rasterMetadata?.crs,
        processingErrors: processingErrors.length > 0 ? processingErrors : undefined,
        diagnostic: totalAffectedPixels === 0 ? {
          warning: 'No pixels found. Possible causes: coordinate system mismatch, geometries outside raster bounds, or processing error.',
          rasterBounds: rasterMetadata?.bounds,
          processingErrors: processingErrors.length > 0 ? processingErrors : 'None',
        } : undefined,
      },
    })

  } catch (error: any) {
    console.error('Hazard impact analysis error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to analyze hazard impact' },
      { status: 500 }
    )
  }
}

