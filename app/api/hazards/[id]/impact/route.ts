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

    console.log(`[API] Hazard has ${affectedAreas.length} affected areas`)

    // Extract geometries from affected_areas (stored as GeoJSON during upload)
    if (affectedAreas.length > 0) {
      for (let i = 0; i < affectedAreas.length; i++) {
        const area = affectedAreas[i]
        console.log(`[API] Processing affected area ${i + 1}:`, {
          hasGeometry: !!area.geometry,
          geometryType: area.geometry?.type,
          hasProperties: !!area.properties,
        })
        
        if (area.geometry && area.geometry.type) {
          // Validate geometry structure
          if (area.geometry.coordinates) {
            hazardGeometries.push(area.geometry)
          } else {
            console.warn(`[API] Affected area ${i + 1} has geometry type but no coordinates`)
          }
        }
      }
    }

    console.log(`[API] Extracted ${hazardGeometries.length} valid geometries from hazard`)

    if (hazardGeometries.length === 0) {
      return NextResponse.json(
        { 
          error: 'Hazard has no valid geometry in affected_areas. Please ensure the hazard was uploaded with geometry data.',
          diagnostic: {
            affectedAreasCount: affectedAreas.length,
            sampleArea: affectedAreas[0] || null,
          },
        },
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
    const geometryDiagnostics: any[] = []
    
    if (analysisType === 'granular') {
      // Granular: extract pixels for each geometry
      for (let i = 0; i < hazardGeometries.length; i++) {
        const geom = hazardGeometries[i]
        if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
          try {
            console.log(`[API] Processing geometry ${i + 1}/${hazardGeometries.length}: ${geom.type}`)
            
            // Get bounding box of this geometry for diagnostics
            let geomBounds: any = null
            if (geom.coordinates) {
              const coords = geom.type === 'Polygon' 
                ? (geom.coordinates as number[][][])
                : (geom.coordinates as number[][][][]).flat(2)
              const allCoords = coords.flat()
              if (allCoords.length > 0) {
                const lons = allCoords.map((c: any) => c[0]).filter((x: any) => typeof x === 'number')
                const lats = allCoords.map((c: any) => c[1]).filter((x: any) => typeof x === 'number')
                if (lons.length > 0 && lats.length > 0) {
                  geomBounds = {
                    minX: Math.min(...lons),
                    maxX: Math.max(...lons),
                    minY: Math.min(...lats),
                    maxY: Math.max(...lats),
                  }
                }
              }
            }
            
            const pixels = await extractPixelsInPolygon(fileBuffer, geom as any)
            console.log(`[API] Found ${pixels.length} pixels for geometry ${i + 1}`)
            
            geometryDiagnostics.push({
              index: i + 1,
              type: geom.type,
              bounds: geomBounds,
              pixelCount: pixels.length,
            })
            
            totalAffectedPixels += pixels.length
            totalAffectedPopulation += pixels.reduce((sum, p) => sum + Math.max(0, p.value), 0)
            pixelDetails.push(...pixels)
          } catch (err: any) {
            console.error(`[API] Error processing geometry ${i + 1}:`, err)
            processingErrors.push(`Geometry ${i + 1}: ${err.message || String(err)}`)
            geometryDiagnostics.push({
              index: i + 1,
              type: geom.type,
              error: err.message || String(err),
            })
          }
        }
      }
    } else {
      // Aggregated: requires zonal statistics
      // This is not implemented yet - would need PostGIS intersection queries
      processingErrors.push('Aggregated analysis requires pre-calculated zonal statistics. Please use "Granular (Pixel-level)" analysis or calculate zonal statistics first.')
    }
    
    // If no pixels found, include diagnostic info
    if (totalAffectedPixels === 0) {
      console.warn('[API] No pixels found. Diagnostic info:', {
        hazardGeometriesCount: hazardGeometries.length,
        rasterMetadata: rasterMetadata ? {
          bounds: rasterMetadata.bounds,
          crs: rasterMetadata.crs,
          width: rasterMetadata.width,
          height: rasterMetadata.height,
        } : null,
        processingErrors: processingErrors.length > 0 ? processingErrors : undefined,
        geometryDiagnostics,
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
        rasterSize: rasterMetadata ? { width: rasterMetadata.width, height: rasterMetadata.height } : undefined,
        processingErrors: processingErrors.length > 0 ? processingErrors : undefined,
        geometryDiagnostics: geometryDiagnostics.length > 0 ? geometryDiagnostics : undefined,
        diagnostic: totalAffectedPixels === 0 ? {
          warning: 'No pixels found. Possible causes: coordinate system mismatch, geometries outside raster bounds, or processing error.',
          rasterBounds: rasterMetadata?.bounds,
          rasterSize: rasterMetadata ? { width: rasterMetadata.width, height: rasterMetadata.height } : undefined,
          rasterCRS: rasterMetadata?.crs,
          processingErrors: processingErrors.length > 0 ? processingErrors : 'None',
          geometryCount: hazardGeometries.length,
          sampleGeometryBounds: geometryDiagnostics.length > 0 ? geometryDiagnostics[0]?.bounds : undefined,
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

