import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import * as shp from 'shapefile'
import JSZip from 'jszip'
import { featureCollection } from '@turf/helpers'

// Debug endpoint to inspect file structure
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
    const filePath = formData.get('filePath') as string | null

    if (!filePath) {
      return NextResponse.json({ error: 'No file path provided' }, { status: 400 })
    }

    // Download file from Supabase Storage
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
    const serviceRoleClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { data: fileData, error: downloadError } = await serviceRoleClient.storage
      .from('admin-boundaries')
      .download(filePath)

    if (downloadError) {
      return NextResponse.json({ error: `Failed to download file: ${downloadError.message}` }, { status: 400 })
    }

    if (!fileData) {
      return NextResponse.json({ error: 'No file data returned' }, { status: 400 })
    }

    // Convert Blob to File-like object
    const fileName = filePath.split('/').pop() || 'file'
    const file = new File([fileData], fileName, { type: fileData.type || 'application/octet-stream' })

    // Process the file
    let geojson: any
    const fileNameLower = file.name.toLowerCase()

    if (fileNameLower.endsWith('.geojson') || fileNameLower.endsWith('.json')) {
      const text = await file.text()
      geojson = JSON.parse(text)
    } else if (fileNameLower.endsWith('.zip')) {
      const arrayBuffer = await file.arrayBuffer()
      const zip = await JSZip.loadAsync(arrayBuffer)
      
      const allFiles: Array<{ path: string; file: JSZip.JSZipObject }> = []
      zip.forEach((relativePath, file) => {
        if (!file.dir) {
          allFiles.push({ path: relativePath, file })
        }
      })
      
      const shpFiles = allFiles.filter(f => f.path.toLowerCase().endsWith('.shp'))
      
      if (shpFiles.length === 0) {
        return NextResponse.json({ 
          error: 'No .shp files found',
          filesInZip: allFiles.map(f => f.path).slice(0, 20)
        }, { status: 400 })
      }
      
      let selectedShp = shpFiles[0]
      for (const shp of shpFiles) {
        const lowerPath = shp.path.toLowerCase()
        if (lowerPath.includes('adm') && !lowerPath.includes('adm0') && !lowerPath.includes('adm1')) {
          selectedShp = shp
          break
        }
      }
      
      const basePath = selectedShp.path.replace(/\.shp$/i, '')
      const dbfFile = allFiles.find(f => 
        f.path.toLowerCase() === `${basePath}.dbf`.toLowerCase()
      )
      
      if (!dbfFile) {
        return NextResponse.json({ 
          error: 'No matching .dbf file found',
          shpFile: selectedShp.path,
          dbfFiles: allFiles.filter(f => f.path.toLowerCase().endsWith('.dbf')).map(f => f.path)
        }, { status: 400 })
      }

      const shpBuffer = await selectedShp.file.async('arraybuffer')
      const dbfBuffer = await dbfFile.file.async('arraybuffer')

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
          return NextResponse.json({ error: 'Shapefile contains no features' }, { status: 400 })
        }

        geojson = featureCollection(features)
      } catch (e) {
        return NextResponse.json({ error: `Failed to parse shapefile: ${(e as Error).message}` }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: 'Unsupported file format' }, { status: 400 })
    }

    if (!geojson || !geojson.features || geojson.features.length === 0) {
      return NextResponse.json({ error: 'No features found in file' }, { status: 400 })
    }

    // Analyze the first few features
    const sampleFeatures = geojson.features.slice(0, 5)
    const allProperties = new Set<string>()
    const propertySamples: Record<string, any> = {}

    sampleFeatures.forEach((feature: any) => {
      const props = feature.properties || {}
      Object.keys(props).forEach(key => {
        allProperties.add(key)
        if (!propertySamples[key]) {
          propertySamples[key] = props[key]
        }
      })
    })

    // Try to detect admin level patterns
    const detectedPatterns: Record<string, string[]> = {}
    const propertyArray = Array.from(allProperties).sort()

    // Look for common patterns
    propertyArray.forEach(prop => {
      const upper = prop.toUpperCase()
      // ADM patterns
      if (upper.match(/^ADM\d+(_EN|_PT|_FR|_ES)?$/i)) {
        const level = prop.match(/\d+/)?.[0]
        if (level) {
          if (!detectedPatterns[`ADM${level}`]) {
            detectedPatterns[`ADM${level}`] = []
          }
          detectedPatterns[`ADM${level}`].push(prop)
        }
      }
      // NAME patterns
      if (upper.match(/^NAME_\d+$/i)) {
        const level = prop.match(/\d+/)?.[0]
        if (level) {
          if (!detectedPatterns[`NAME_${level}`]) {
            detectedPatterns[`NAME_${level}`] = []
          }
          detectedPatterns[`NAME_${level}`].push(prop)
        }
      }
      // PCODE patterns
      if (upper.match(/^(ADM\d+_)?PCODE(\d+)?$/i) || upper.match(/^PCODE\d+$/i)) {
        if (!detectedPatterns['PCODE']) {
          detectedPatterns['PCODE'] = []
        }
        detectedPatterns['PCODE'].push(prop)
      }
    })

    return NextResponse.json({
      success: true,
      totalFeatures: geojson.features.length,
      sampleFeaturesAnalyzed: sampleFeatures.length,
      allProperties: propertyArray,
      propertySamples: Object.fromEntries(
        Object.entries(propertySamples).slice(0, 30) // Limit to first 30
      ),
      detectedPatterns,
      recommendations: propertyArray.length > 0 ? 
        `Found ${propertyArray.length} properties. Look for fields containing 'ADM', 'NAME', or 'PCODE' patterns.` :
        'No properties found in features.'
    })
  } catch (error: any) {
    console.error('Debug error:', error)
    return NextResponse.json(
      { error: error.message || 'Debug failed' },
      { status: 500 }
    )
  }
}

