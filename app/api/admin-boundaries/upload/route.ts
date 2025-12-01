import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import simplify from '@turf/simplify'
import { featureCollection } from '@turf/helpers'
import * as shp from 'shapefile'
import JSZip from 'jszip'
import { inferPcodePatternsFromBoundaries } from '@/lib/processing/pcode-inference'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const countryId = formData.get('countryId') as string
    const processAllLevels = formData.get('processAllLevels') === 'true'
    const autoDetect = formData.get('autoDetect') === 'true'
    const simplifyTolerance = parseFloat(formData.get('simplifyTolerance') as string) || 0.0001
    const hdxUrl = formData.get('hdxUrl') as string | null
    const file = formData.get('file') as File | null

    let geojson: any

    // Fetch or process file
    if (hdxUrl) {
      // Fetch from HDX - this is a simplified version
      // HDX API would need to be implemented properly
      // For now, we'll expect a direct GeoJSON URL or handle the HDX dataset page
      geojson = await fetchFromHDX(hdxUrl)
    } else if (file) {
      geojson = await processFile(file)
    } else {
      return NextResponse.json({ error: 'No data source provided' }, { status: 400 })
    }

    if (!geojson || !geojson.features) {
      return NextResponse.json({ error: 'Invalid GeoJSON data' }, { status: 400 })
    }

    // Simplify geometries
    const simplified = simplify(geojson, { tolerance: simplifyTolerance, highQuality: true })

    // Detect available admin levels from the first feature
    const firstFeature = simplified.features[0]
    const properties = firstFeature?.properties || {}
    
    // Find all ADM level fields (ADM0_EN, ADM1_EN, ADM2_EN, etc.)
    const detectedLevels = new Map<number, { nameField: string; pcodeField: string }>()
    
    if (autoDetect && processAllLevels) {
      // Auto-detect ADM fields
      for (let level = 0; level <= 6; level++) {
        const nameField = `ADM${level}_EN`
        const pcodeField = `ADM${level}_PCODE`
        
        if (properties[nameField] || properties[pcodeField]) {
          detectedLevels.set(level, { nameField, pcodeField })
        }
      }
    } else {
      // Single level processing (legacy mode)
      // This would require the old form fields
      throw new Error('Please use "Process all admin levels" mode')
    }

    if (detectedLevels.size === 0) {
      return NextResponse.json(
        { error: 'No admin level fields detected. Ensure your file has ADM0_EN, ADM1_EN, etc. fields.' },
        { status: 400 }
      )
    }

    // Process each level
    const summary: Record<number, number> = {}
    const allBoundariesByLevel = new Map<number, any[]>()
    const pcodeToIdMap = new Map<string, { level: number; id: string }>()

    // Sort levels to process from highest (Adm0) to lowest
    const sortedLevels = Array.from(detectedLevels.keys()).sort((a, b) => a - b)

    for (const level of sortedLevels) {
      const { nameField, pcodeField } = detectedLevels.get(level)!
      const boundaries: any[] = []
      const parentLevel = level > 0 ? level - 1 : null

      for (const feature of simplified.features) {
        const name = feature.properties?.[nameField] || feature.properties?.[`ADM${level}_EN`] || null
        const pcode = feature.properties?.[pcodeField] || feature.properties?.[`ADM${level}_PCODE`] || null

        if (!name) continue

        const geom = feature.geometry
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
          continue
        }

        // Find parent Pcode
        const parentPcode = parentLevel !== null
          ? (feature.properties?.[`ADM${parentLevel}_PCODE`] || null)
          : null

        boundaries.push({
          level,
          name,
          pcode,
          parentPcode,
          geometry: geom, // Pass as object, not stringified
        })
      }

      allBoundariesByLevel.set(level, boundaries)
    }

    // Insert boundaries level by level, building hierarchy
    for (const level of sortedLevels) {
      const boundaries = allBoundariesByLevel.get(level) || []
      let insertedCount = 0
      const errors: string[] = []

      for (const boundary of boundaries) {
        // Find parent ID if parent level exists
        let parentId = null
        if (boundary.parentPcode && level > 0) {
          const parentMapping = pcodeToIdMap.get(`${level - 1}:${boundary.parentPcode}`)
          if (parentMapping) {
            parentId = parentMapping.id
          }
        }

        // Validate geometry before sending
        if (!boundary.geometry || typeof boundary.geometry !== 'object') {
          errors.push(`${boundary.name}: Invalid geometry`)
          continue
        }

        const geom = boundary.geometry as any
        if (!geom.type || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
          errors.push(`${boundary.name}: Geometry must be Polygon or MultiPolygon, got ${geom.type}`)
          continue
        }

        try {
          const { data: insertedId, error } = await supabase.rpc('insert_admin_boundary', {
            p_country_id: countryId,
            p_level: boundary.level,
            p_name: boundary.name,
            p_pcode: boundary.pcode || null,
            p_parent_id: parentId,
            p_geometry: geom as any, // Pass as JSONB object
          })
          
          if (error) {
            const errorMsg = `${boundary.name}: ${error.message}`
            errors.push(errorMsg)
            console.error(`Error inserting boundary ${boundary.name}:`, error.message, error.details, error.hint)
          } else if (insertedId) {
            insertedCount++
            if (boundary.pcode) {
              pcodeToIdMap.set(`${level}:${boundary.pcode}`, { level, id: insertedId })
            }
          } else {
            errors.push(`${boundary.name}: Function returned null`)
          }
        } catch (e: any) {
          errors.push(`${boundary.name}: ${e.message || 'Unknown error'}`)
          console.error(`Exception inserting boundary ${boundary.name}:`, e)
        }
      }
      
      if (errors.length > 0 && insertedCount === 0) {
        // If all failed, throw error with details
        throw new Error(`Failed to insert boundaries. First error: ${errors[0]}`)
      } else if (errors.length > 0) {
        // Log warnings but continue
        console.warn(`Some boundaries failed to insert: ${errors.slice(0, 5).join('; ')}`)
      }

      summary[level] = insertedCount
    }

    // Infer Pcode patterns from uploaded data and update country config
    let inferredPatterns: Map<number, string> = new Map()
    
    if (allBoundariesByLevel.size > 0) {
      inferredPatterns = inferPcodePatternsFromBoundaries(allBoundariesByLevel)
      
      // Get current country config
      const { data: country } = await supabase
        .from('countries')
        .select('config')
        .eq('id', countryId)
        .single()
      
      if (country && country.config) {
        const config = country.config as any
        if (config.adminLevels) {
          // Update patterns for each level
          config.adminLevels = config.adminLevels.map((levelConfig: any) => {
            const inferred = inferredPatterns.get(levelConfig.level)
            if (inferred) {
              return { ...levelConfig, pcodePattern: inferred }
            }
            return levelConfig
          })
          
          // Save updated config
          await supabase
            .from('countries')
            .update({ config, updated_at: new Date().toISOString() })
            .eq('id', countryId)
        }
      }
    }

    return NextResponse.json({ 
      summary, 
      success: true,
      patternsInferred: Array.from(inferredPatterns.entries())
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    )
  }
}

async function fetchFromHDX(url: string): Promise<any> {
  // HDX API integration - simplified version
  // In production, you'd need to:
  // 1. Parse the HDX dataset page
  // 2. Find the GeoJSON/Shapefile download URL
  // 3. Fetch and parse it

  // For now, return an error asking for direct GeoJSON URL
  throw new Error(
    'HDX direct integration coming soon. Please download the GeoJSON file and upload it directly, or provide a direct GeoJSON URL.'
  )
}

async function processFile(file: File): Promise<any> {
  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
    const text = await file.text()
    try {
      return JSON.parse(text)
    } catch (e) {
      throw new Error(`Invalid GeoJSON file: ${(e as Error).message}`)
    }
  } else if (fileName.endsWith('.zip')) {
    // Handle shapefile - COD files often have multiple shapefiles, we'll process the first one
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)
    
    // Get all files in the zip
    const allFiles: Array<{ path: string; file: JSZip.JSZipObject }> = []
    zip.forEach((relativePath, file) => {
      if (!file.dir) {
        allFiles.push({ path: relativePath, file })
      }
    })
    
    // Find all .shp files (COD files may have multiple - one per admin level)
    const shpFiles = allFiles.filter(f => f.path.toLowerCase().endsWith('.shp'))
    
    if (shpFiles.length === 0) {
      const fileList = allFiles.map(f => f.path).slice(0, 10).join(', ')
      throw new Error(
        `No .shp files found in zip. Found files: ${fileList || 'none'}. ` +
        `Please ensure your zip contains .shp files.`
      )
    }
    
    // For COD files, typically there's one shapefile with all admin levels
    // Try to find the main one (usually the largest or has 'adm' in name)
    let selectedShp = shpFiles[0]
    for (const shp of shpFiles) {
      const lowerPath = shp.path.toLowerCase()
      if (lowerPath.includes('adm') && !lowerPath.includes('adm0') && !lowerPath.includes('adm1')) {
        selectedShp = shp
        break
      }
    }
    
    // Find corresponding .dbf file (same base name)
    const basePath = selectedShp.path.replace(/\.shp$/i, '')
    const dbfFile = allFiles.find(f => 
      f.path.toLowerCase() === `${basePath}.dbf`.toLowerCase()
    )
    
    if (!dbfFile) {
      const dbfFiles = allFiles.filter(f => f.path.toLowerCase().endsWith('.dbf'))
      throw new Error(
        `No matching .dbf file found for ${selectedShp.path}. ` +
        `Found .dbf files: ${dbfFiles.map(f => f.path).join(', ')}. ` +
        `The .shp and .dbf files must have the same base name.`
      )
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
  } else {
    throw new Error('Unsupported file format. Use GeoJSON (.geojson, .json) or Shapefile (.zip)')
  }
}

