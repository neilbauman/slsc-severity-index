import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import simplify from '@turf/simplify'
import { featureCollection } from '@turf/helpers'
import * as shp from 'shapefile'
import JSZip from 'jszip'

export const maxDuration = 300 // 5 minutes for processing large files
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Convert shapefile from zip to GeoJSON
 */
async function processShapefileFromZip(zipBuffer: ArrayBuffer): Promise<any> {
  const zip = await JSZip.loadAsync(zipBuffer)
  const allFiles = Object.keys(zip.files)
    .map(path => ({ path, file: zip.files[path] }))
    .filter(({ file }) => !file.dir)

  // Find shapefile
  const shpFiles = allFiles.filter(f => f.path.toLowerCase().endsWith('.shp'))
  
  if (shpFiles.length === 0) {
    throw new Error('No .shp files found in zip. Please ensure your zip contains a Shapefile (.shp and .dbf files).')
  }

  // Use the first shapefile (or could select based on name patterns)
  const selectedShp = shpFiles[0]
  const basePath = selectedShp.path.replace(/\.shp$/i, '')
  const dbfFile = allFiles.find(f => 
    f.path.toLowerCase() === `${basePath}.dbf`.toLowerCase()
  )
  
  if (!dbfFile) {
    throw new Error(`No matching .dbf file found for ${selectedShp.path}. Shapefiles require both .shp and .dbf files with the same base name.`)
  }

  const shpBuffer = await selectedShp.file.async('arraybuffer')
  const dbfBuffer = await dbfFile.file.async('arraybuffer')

  // Convert shapefile to GeoJSON
  try {
    const source = await shp.open(shpBuffer, dbfBuffer)
    const features: any[] = []

    let result = await source.read()
    while (!result.done) {
      if (result.value) {
        features.push(result.value)
      }
      result = await source.read()
    }

    if (features.length === 0) {
      throw new Error('Shapefile contains no features')
    }

    return featureCollection(features)
  } catch (e) {
    throw new Error(`Failed to parse shapefile: ${(e as Error).message}`)
  }
}

/**
 * Process file from Supabase Storage
 */
async function processFileFromStorage(
  supabase: any,
  filePath: string
): Promise<any> {
  const { data: fileData, error: fileError } = await supabase.storage
    .from('admin-boundaries')
    .download(filePath)

  if (fileError || !fileData) {
    throw new Error(`Failed to download file from storage: ${fileError?.message || 'Unknown error'}`)
  }

  const fileExtension = filePath.split('.').pop()?.toLowerCase()

  if (fileExtension === 'json' || fileExtension === 'geojson') {
    const text = await fileData.text()
    const geojson = JSON.parse(text)
    if (!geojson.features || !Array.isArray(geojson.features)) {
      throw new Error('Invalid GeoJSON: missing features array')
    }
    return geojson
  } else if (fileExtension === 'zip') {
    const arrayBuffer = await fileData.arrayBuffer()
    return await processShapefileFromZip(arrayBuffer)
  } else {
    throw new Error(`Unsupported file format: .${fileExtension}. Use GeoJSON or Shapefile (ZIP).`)
  }
}

/**
 * Download file from URL
 */
async function downloadFromUrl(url: string): Promise<{ buffer: ArrayBuffer; filename: string }> {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download from URL: ${response.status} ${response.statusText}`)
    }
    
    const buffer = await response.arrayBuffer()
    const contentDisposition = response.headers.get('content-disposition')
    let filename = 'hazard_data.zip'
    
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch) {
        filename = filenameMatch[1].replace(/['"]/g, '')
      }
    } else {
      // Try to extract filename from URL
      const urlParts = url.split('/')
      const lastPart = urlParts[urlParts.length - 1]
      if (lastPart && lastPart.includes('.')) {
        filename = lastPart.split('?')[0] // Remove query params
      }
    }
    
    return { buffer, filename }
  } catch (error: any) {
    throw new Error(`Failed to download from URL: ${error.message}`)
  }
}

/**
 * Convert GeoJSON to PostGIS geometry format and store hazard
 */
async function storeHazard(
  supabase: any,
  countryId: string,
  name: string,
  type: string,
  date: string | null,
  geojson: any,
  metadata: any,
  userId: string
) {
  if (!geojson.features || geojson.features.length === 0) {
    throw new Error('No features found in hazard data')
  }

  // Simplify geometries for storage
  const simplified = simplify(geojson, { tolerance: 0.0001, highQuality: true })

  // For hazards, we can store:
  // 1. A single geometry (union of all features) - for simple cases
  // 2. Multiple geometries stored in affected_areas JSON
  // 3. Or create one hazard record per feature (for complex datasets)

  // For now, let's create one hazard record with a union of all features
  // If there are many features, we'll store them in affected_areas
  let geometry: any = null
  let affectedAreas: any = null

  if (simplified.features.length === 1) {
    // Single feature - use its geometry directly
    geometry = simplified.features[0].geometry
    affectedAreas = simplified.features.map((f: any) => ({
      properties: f.properties || {},
      geometry: f.geometry,
    }))
  } else {
    // Multiple features - try to union them if they're all polygons
    // Otherwise, store all features in affected_areas
    const allPolygons = simplified.features.every((f: any) => 
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
    )

    if (allPolygons && simplified.features.length <= 100) {
      // Try to union polygons for single geometry storage
      try {
        const { union } = await import('@turf/union')
        let unioned = simplified.features[0].geometry
        
        for (let i = 1; i < simplified.features.length; i++) {
          const nextGeom = simplified.features[i].geometry
          if (unioned && nextGeom) {
            const feature1 = {
              type: 'Feature' as const,
              geometry: unioned,
              properties: {}
            }
            const feature2 = {
              type: 'Feature' as const,
              geometry: nextGeom,
              properties: {}
            }
            const unionResult = union(feature1 as any, feature2 as any)
            if (unionResult?.geometry) {
              unioned = unionResult.geometry
            }
          }
        }
        geometry = unioned
      } catch (unionError) {
        console.warn('Failed to union geometries, storing as separate features:', unionError)
        // Fall through to store in affected_areas
      }
    }

    // Store all features in affected_areas
    affectedAreas = simplified.features.map((f: any) => ({
      properties: f.properties || {},
      geometry: f.geometry,
    }))
  }

  // If we couldn't create a single geometry, use the first feature's geometry as the main one
  if (!geometry && simplified.features.length > 0) {
    geometry = simplified.features[0].geometry
  }

  // Use RPC function to insert hazard with PostGIS geometry conversion
  const geometryGeojson = geometry ? JSON.stringify(geometry) : null
  
  // Try using the insert_hazard RPC function first
  const { data: hazard, error: insertError } = await supabase.rpc('insert_hazard', {
    p_country_id: countryId,
    p_name: name,
    p_type: type,
    p_date: date || null,
    p_geometry_json: geometryGeojson,
    p_affected_areas: affectedAreas,
    p_metadata: {
      ...metadata,
      featureCount: simplified.features.length,
      geometryTypes: [...new Set(simplified.features.map((f: any) => f.geometry?.type))],
    },
    p_uploaded_by: userId,
  })
  
  // If RPC function doesn't exist, fall back to direct insert (may fail if geometry column requires conversion)
  if (insertError && (
    insertError.message?.includes('Could not find the function') ||
    insertError.message?.includes('function insert_hazard') ||
    insertError.message?.includes('does not exist') ||
    insertError.code === '42883'
  )) {
    console.warn('insert_hazard function not found, attempting direct insert. Please run the migration create_insert_hazard_function.sql')
    
    // Try direct insert - this may fail if geometry column doesn't accept JSONB/text
    const { data: hazardDirect, error: directError } = await supabase
      .from('hazards')
      .insert({
        country_id: countryId,
        name,
        type,
        date: date || null,
        geometry: geometry as any, // May fail if column requires PostGIS geography type
        affected_areas: affectedAreas,
        metadata: {
          ...metadata,
          featureCount: simplified.features.length,
          geometryTypes: [...new Set(simplified.features.map((f: any) => f.geometry?.type))],
        },
        uploaded_by: userId,
      })
      .select()
      .single()
    
    if (directError) {
      throw new Error(
        `Failed to store hazard: The insert_hazard database function is required. ` +
        `Please run the migration 'create_insert_hazard_function.sql' in your Supabase SQL editor. ` +
        `Error: ${directError.message}`
      )
    }
    return hazardDirect
  }
  
  if (insertError) {
    console.error('Hazard insert error:', insertError)
    throw new Error(`Failed to store hazard: ${insertError.message}`)
  }

  return hazard?.[0] || hazard // RPC may return array or single object
}

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

    const { countryId, name, type, date, filePath, sourceUrl } = await request.json()

    if (!countryId || !name || !type) {
      return NextResponse.json(
        { error: 'Missing required fields: countryId, name, type' },
        { status: 400 }
      )
    }

    let geojson: any

    if (sourceUrl) {
      // Download from URL
      console.log('Downloading hazard data from URL:', sourceUrl)
      const { buffer, filename } = await downloadFromUrl(sourceUrl)
      
      const fileExtension = filename.split('.').pop()?.toLowerCase()
      
      if (fileExtension === 'zip') {
        geojson = await processShapefileFromZip(buffer)
      } else if (fileExtension === 'json' || fileExtension === 'geojson') {
        const text = new TextDecoder().decode(buffer)
        geojson = JSON.parse(text)
        if (!geojson.features || !Array.isArray(geojson.features)) {
          throw new Error('Invalid GeoJSON: missing features array')
        }
      } else {
        throw new Error(`Unsupported file format from URL: .${fileExtension}`)
      }
    } else if (filePath) {
      // Process from Supabase Storage
      console.log('Processing hazard file from storage:', filePath)
      geojson = await processFileFromStorage(serviceRoleSupabase, filePath)
    } else {
      return NextResponse.json(
        { error: 'Either filePath or sourceUrl must be provided' },
        { status: 400 }
      )
    }

    if (!geojson || !geojson.features || geojson.features.length === 0) {
      return NextResponse.json(
        { error: 'No features found in hazard data' },
        { status: 400 }
      )
    }

    console.log(`Processing ${geojson.features.length} hazard features`)

    // Store hazard
    const hazard = await storeHazard(
      serviceRoleSupabase,
      countryId,
      name,
      type,
      date,
      geojson,
      {
        sourceUrl: sourceUrl || null,
        filePath: filePath || null,
      },
      user.id
    )

    return NextResponse.json({
      success: true,
      hazard,
      featureCount: geojson.features.length,
    })

  } catch (error: any) {
    console.error('Hazard upload error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to upload hazard' },
      { status: 500 }
    )
  }
}

