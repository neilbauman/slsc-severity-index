/**
 * Raster processing utilities for GeoTIFF files
 * Supports both zonal statistics and granular pixel-level analysis
 */

import { fromArrayBuffer } from 'geotiff'

export interface RasterMetadata {
  width: number
  height: number
  pixelWidth: number // degrees
  pixelHeight: number // degrees
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
  crs: string | null
  noDataValue: number | null
  dataType: string
}

export interface ZonalStatistics {
  pcode: string
  name: string
  adminLevel: number
  population: number
  pixelCount: number
  areaKm2?: number
}

export interface PixelValue {
  x: number // longitude
  y: number // latitude
  value: number
}

/**
 * Extract metadata from a GeoTIFF file
 */
export async function extractRasterMetadata(fileBuffer: ArrayBuffer): Promise<RasterMetadata> {
  try {
    const tiff = await fromArrayBuffer(fileBuffer)
    const image = await tiff.getImage()
    
    const [minX, minY, maxX, maxY] = image.getBoundingBox()
    const [pixelWidth, pixelHeight] = image.getResolution()
    
    // Try to read a small sample to get data type (without window to avoid type issues)
    let dataType = 'Unknown'
    try {
      // Read just a tiny region - use width/height to avoid full read
      // For now, just assume Float32 or use image sampleFormat if available
      const sampleFormat = (image as any).sampleFormat
      if (sampleFormat) {
        dataType = sampleFormat === 1 ? 'Int16' : sampleFormat === 2 ? 'Int32' : 'Float32'
      } else {
        dataType = 'Float32' // Default assumption for population rasters
      }
    } catch (e) {
      // Fallback
      dataType = 'Float32'
    }
    
    // Get CRS info - can be in various formats
    let crs: string | null = null
    if (image.geoKeys) {
      crs = image.geoKeys.ProjectedCSTypeGeoKey?.toString() || 
            image.geoKeys.GeographicTypeGeoKey?.toString() ||
            image.geoKeys.GTModelTypeGeoKey?.toString() ||
            null
    }
    
    return {
      width: image.getWidth(),
      height: image.getHeight(),
      pixelWidth: Math.abs(pixelWidth),
      pixelHeight: Math.abs(pixelHeight),
      bounds: {
        minX,
        minY,
        maxX,
        maxY,
      },
      crs,
      noDataValue: image.getGDALNoData() || null,
      dataType,
    }
  } catch (error: any) {
    console.error('Error extracting raster metadata:', error)
    throw new Error(`Failed to read GeoTIFF: ${error.message || String(error)}`)
  }
}

/**
 * Extract pixel values within a polygon (for granular analysis)
 */
export async function extractPixelsInPolygon(
  fileBuffer: ArrayBuffer,
  polygon: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
): Promise<PixelValue[]> {
  const tiff = await fromArrayBuffer(fileBuffer)
  const image = await tiff.getImage()
  const [minX, minY, maxX, maxY] = image.getBoundingBox()
  const [pixelWidth, pixelHeight] = image.getResolution()
  const [width, height] = [image.getWidth(), image.getHeight()]
  
  const rasters = await image.readRasters()
  const data = rasters[0] as Float32Array | Float64Array | Int16Array | Int32Array
  
  const pixels: PixelValue[] = []
  const noDataValue = image.getGDALNoData()
  
  // Extract all coordinates from polygon (handle both Polygon and MultiPolygon)
  // GeoJSON Polygon: coordinates is number[][][] where each ring is number[][] (array of [lon, lat] pairs)
  // GeoJSON MultiPolygon: coordinates is number[][][][] where each polygon has rings
  // allRings is an array of rings, where each ring is number[][] (array of coordinate pairs)
  const allRings: number[][][] = []
  if (polygon.type === 'Polygon') {
    // Polygon coordinates: number[][][] (array of rings)
    const polyCoords = polygon.coordinates as number[][][]
    for (const ring of polyCoords) {
      allRings.push(ring)
    }
  } else {
    // MultiPolygon coordinates: number[][][][] (array of polygons, each has rings)
    const multiCoords = polygon.coordinates as number[][][][]
    for (const poly of multiCoords) {
      for (const ring of poly) {
        allRings.push(ring)
      }
    }
  }
  
  // Get bounding box of polygon for optimization
  let polyMinX = Infinity, polyMinY = Infinity, polyMaxX = -Infinity, polyMaxY = -Infinity
  for (const ring of allRings) {
    for (const coord of ring) {
      const [lon, lat] = coord
      polyMinX = Math.min(polyMinX, lon)
      polyMinY = Math.min(polyMinY, lat)
      polyMaxX = Math.max(polyMaxX, lon)
      polyMaxY = Math.max(polyMaxY, lat)
    }
  }
  
  // Check if polygon bounds overlap with raster bounds at all
  if (polyMaxX < minX || polyMinX > maxX || polyMaxY < minY || polyMinY > maxY) {
    console.warn('Polygon bounds do not overlap with raster bounds:', {
      polygon: { minX: polyMinX, minY: polyMinY, maxX: polyMaxX, maxY: polyMaxY },
      raster: { minX, minY, maxX, maxY },
    })
    return [] // No overlap
  }
  
  // Calculate which pixel rows/columns we need to check (optimize for large rasters)
  // Only read the region that intersects with the polygon bounding box
  const startCol = Math.max(0, Math.floor((polyMinX - minX) / pixelWidth))
  const endCol = Math.min(width - 1, Math.ceil((polyMaxX - minX) / pixelWidth))
  const startRow = Math.max(0, Math.floor((maxY - polyMaxY) / pixelHeight))
  const endRow = Math.min(height - 1, Math.ceil((maxY - polyMinY) / pixelHeight))
  
  console.log('Processing raster region:', {
    fullRaster: { width, height, totalPixels: width * height },
    region: { startRow, endRow, startCol, endCol, regionPixels: (endRow - startRow + 1) * (endCol - startCol + 1) },
    polygonBounds: { minX: polyMinX, minY: polyMinY, maxX: polyMaxX, maxY: polyMaxY },
  })
  
  // For optimization, we calculate the region bounds, but read the full raster
  // Windowed reads in geotiff.js have a different API format and can be complex
  // For now, we read the full raster but only process pixels in the relevant region
  const regionData = data
  const regionWidth = width
  const regionHeight = height
  const regionOffsetX = 0
  const regionOffsetY = 0
  
  // Iterate through pixels in the region
  let pixelsChecked = 0
  let pixelsInBounds = 0
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      pixelsChecked++
      
      // Calculate pixel center coordinates
      const x = minX + (col + 0.5) * pixelWidth
      const y = maxY - (row + 0.5) * pixelHeight // Y is top-down in rasters
      
      // Additional bounds check (should be redundant but safe)
      if (x < polyMinX || x > polyMaxX || y < polyMinY || y > polyMaxY) {
        continue
      }
      
      pixelsInBounds++
      
      // Get value from region data or full data
      const dataRow = row - regionOffsetY
      const dataCol = col - regionOffsetX
      const value = regionData[dataRow * regionWidth + dataCol]
      
      // Skip no-data values
      if (noDataValue !== null && (isNaN(value as any) || value === noDataValue)) {
        continue
      }
      
      // Skip negative or invalid values
      if (isNaN(value as any) || value < 0) {
        continue
      }
      
      // Check if point is inside polygon (point-in-polygon test)
      // For Polygon: first ring is outer, subsequent are holes
      // For MultiPolygon: need to check each polygon separately
      if (polygon.type === 'Polygon') {
        const rings = polygon.coordinates as number[][][]
        if (rings.length > 0) {
          const outerRing = rings[0]
          const holes = rings.slice(1)
          if (isPointInPolygon([x, y], outerRing, holes)) {
            pixels.push({ x, y, value: Number(value) })
          }
        }
      } else if (polygon.type === 'MultiPolygon') {
        // For MultiPolygon, check if point is in any of the polygons
        const multiCoords = polygon.coordinates as number[][][][]
        let isInside = false
        for (const poly of multiCoords) {
          if (poly.length > 0) {
            const outerRing = poly[0]
            const holes = poly.slice(1)
            if (isPointInPolygon([x, y], outerRing, holes)) {
              isInside = true
              break // Point is inside this polygon, no need to check others
            }
          }
        }
        if (isInside) {
          pixels.push({ x, y, value: Number(value) })
        }
      }
    }
  }
  
  // Log diagnostic info if no pixels found
  if (pixels.length === 0) {
    // Sample a few points to see what's happening
    const samplePoints: any[] = []
    const sampleCount = Math.min(10, pixelsChecked)
    let sampleIndex = 0
    for (let row = startRow; row <= endRow && sampleIndex < sampleCount; row++) {
      for (let col = startCol; col <= endCol && sampleIndex < sampleCount; col++) {
        const x = minX + (col + 0.5) * pixelWidth
        const y = maxY - (row + 0.5) * pixelHeight
        const dataRow = row - regionOffsetY
        const dataCol = col - regionOffsetX
        const value = regionData[dataRow * regionWidth + dataCol]
        const inOuterBounds = !(x < polyMinX || x > polyMaxX || y < polyMinY || y > polyMaxY)
        
        // Test point-in-polygon for sample
        let pointInPolygon = false
        if (polygon.type === 'Polygon') {
          const rings = polygon.coordinates as number[][][]
          if (rings.length > 0) {
            pointInPolygon = isPointInPolygon([x, y], rings[0], rings.slice(1))
          }
        } else if (polygon.type === 'MultiPolygon') {
          const multiCoords = polygon.coordinates as number[][][][]
          for (const poly of multiCoords) {
            if (poly.length > 0 && isPointInPolygon([x, y], poly[0], poly.slice(1))) {
              pointInPolygon = true
              break
            }
          }
        }
        
        samplePoints.push({
          row,
          col,
          x: x.toFixed(4),
          y: y.toFixed(4),
          value,
          isNoData: noDataValue !== null && value === noDataValue,
          isNegative: value < 0,
          inBounds: inOuterBounds,
          pointInPolygon,
        })
        sampleIndex++
      }
    }
    
    console.warn('No pixels found in polygon. Diagnostic info:', {
      polygonBounds: { minX: polyMinX, minY: polyMinY, maxX: polyMaxX, maxY: polyMaxY },
      rasterBounds: { minX, minY, maxX, maxY },
      pixelResolution: { pixelWidth, pixelHeight },
      region: { startRow, endRow, startCol, endCol },
      pixelsChecked,
      pixelsInBounds,
      ringsCount: allRings.length,
      outerRingLength: allRings[0]?.length,
      noDataValue,
      samplePoints,
    })
  } else {
    console.log(`Found ${pixels.length} pixels in polygon`)
  }
  
  return pixels
}

/**
 * Point-in-polygon test using ray casting algorithm
 * @param point The point to test [lon, lat]
 * @param outerRing The outer ring of the polygon
 * @param holes Optional array of hole rings (for Polygon with interior rings)
 */
function isPointInPolygon(
  point: [number, number],
  outerRing: number[][],
  holes: number[][][] = []
): boolean {
  const [x, y] = point
  
  // First check if point is in outer ring
  let inside = false
  for (let i = 0, j = outerRing.length - 1; i < outerRing.length; j = i++) {
    const [xi, yi] = outerRing[i]
    const [xj, yj] = outerRing[j]
    
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  
  if (!inside) {
    return false // Not in outer ring
  }
  
  // If inside outer ring, check if point is in any hole (if so, exclude it)
  for (const hole of holes) {
    let inHole = false
    for (let i = 0, j = hole.length - 1; i < hole.length; j = i++) {
      const [xi, yi] = hole[i]
      const [xj, yj] = hole[j]
      
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
      if (intersect) inHole = !inHole
    }
    if (inHole) {
      return false // Point is in a hole, so it's outside the polygon
    }
  }
  
  return true // In outer ring and not in any holes
}

/**
 * Calculate zonal statistics: sum population per admin boundary
 * This reads the raster and aggregates by admin unit polygons
 */
export async function calculateZonalStatistics(
  fileBuffer: ArrayBuffer,
  adminBoundaries: Array<{
    pcode: string
    name: string
    level: number
    geometry: {
      type: 'Polygon' | 'MultiPolygon'
      coordinates: number[][][] | number[][][][]
    }
  }>
): Promise<ZonalStatistics[]> {
  const results: ZonalStatistics[] = []
  
  for (const boundary of adminBoundaries) {
    const pixels = await extractPixelsInPolygon(fileBuffer, boundary.geometry)
    
    const population = pixels.reduce((sum, pixel) => sum + Math.max(0, pixel.value), 0)
    
    results.push({
      pcode: boundary.pcode,
      name: boundary.name,
      adminLevel: boundary.level,
      population: Math.round(population),
      pixelCount: pixels.length,
    })
  }
  
  return results
}

