import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import simplify from '@turf/simplify'
import { featureCollection } from '@turf/helpers'
import * as shp from 'shapefile'
import JSZip from 'jszip'

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
    const level = parseInt(formData.get('level') as string)
    const nameField = formData.get('nameField') as string
    const pcodeField = formData.get('pcodeField') as string
    const parentField = (formData.get('parentField') as string) || null
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

    // Process features
    const boundaries: any[] = []
    const parentMap = new Map<string, string>()

    // First pass: create boundaries and map parent relationships
    for (const feature of simplified.features) {
      const name = feature.properties?.[nameField] || feature.properties?.name || 'Unknown'
      const pcode = feature.properties?.[pcodeField] || feature.properties?.pcode || null
      const parentPcode = parentField ? feature.properties?.[parentField] : null

      if (!name) continue

      // Convert GeoJSON to PostGIS format (Well-Known Text)
      const geom = feature.geometry
      if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
        continue
      }

      boundaries.push({
        name,
        pcode,
        parentPcode,
        geometry: JSON.stringify(geom),
      })
    }

    // Get parent IDs for hierarchy
    if (parentField && level > 0) {
      const { data: parentBoundaries } = await supabase
        .from('admin_boundaries')
        .select('id, pcode')
        .eq('country_id', countryId)
        .eq('level', level - 1)

      const parentIdMap = new Map<string, string>()
      parentBoundaries?.forEach((p) => {
        if (p.pcode) {
          parentIdMap.set(p.pcode, p.id)
        }
      })

      boundaries.forEach((b) => {
        if (b.parentPcode && parentIdMap.has(b.parentPcode)) {
          b.parent_id = parentIdMap.get(b.parentPcode)
        }
      })
    }

    // Insert into database using PostGIS function
    let insertedCount = 0
    for (const boundary of boundaries) {
      const { error } = await supabase.rpc('insert_admin_boundary', {
        p_country_id: countryId,
        p_level: level,
        p_name: boundary.name,
        p_pcode: boundary.pcode,
        p_parent_id: boundary.parent_id || null,
        p_geometry: boundary.geometry,
      })

      if (!error) {
        insertedCount++
      }
    }

    return NextResponse.json({ count: insertedCount, success: true })
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
    return JSON.parse(text)
  } else if (fileName.endsWith('.zip')) {
    // Handle shapefile
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)
    const shpBuffer = await zip.file(fileName.replace('.zip', '.shp'))?.async('arraybuffer')
    const dbfBuffer = await zip.file(fileName.replace('.zip', '.dbf'))?.async('arraybuffer')

    if (!shpBuffer || !dbfBuffer) {
      throw new Error('Shapefile is missing .shp or .dbf file')
    }

    // Convert shapefile to GeoJSON
    const source = await shp.open(shpBuffer, dbfBuffer)
    const features: any[] = []

    let result = await source.read()
    while (!result.done) {
      features.push(result.value)
      result = await source.read()
    }

    return featureCollection(features)
  } else {
    throw new Error('Unsupported file format. Use GeoJSON (.geojson) or Shapefile (.zip)')
  }
}

