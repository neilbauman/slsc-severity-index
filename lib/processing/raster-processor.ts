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
    
    // Try to read a small sample to get data type
    let dataType = 'Unknown'
    try {
      const rasters = await image.readRasters({ window: [[0, 1], [0, 1]] })
      dataType = rasters[0]?.constructor?.name || 'Float32'
    } catch (e) {
      // Fallback if windowed read fails
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
  
  // Iterate through pixels that intersect with polygon bounds
  let pixelsChecked = 0
  let pixelsInBounds = 0
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      pixelsChecked++
      
      // Calculate pixel center coordinates
      const x = minX + (col + 0.5) * pixelWidth
      const y = maxY - (row + 0.5) * pixelHeight // Y is top-down in rasters
      
      // Quick bounds check
      if (x < polyMinX || x > polyMaxX || y < polyMinY || y > polyMaxY) {
        continue
      }
      
      pixelsInBounds++
      
      const value = data[row * width + col]
      
      // Skip no-data values
      if (noDataValue !== null && (isNaN(value as any) || value === noDataValue)) {
        continue
      }
      
      // Check if point is inside polygon (point-in-polygon test)
      // Use the first (outer) ring for point-in-polygon test
      if (allRings.length > 0) {
        const outerRing = allRings[0]
        if (isPointInPolygon([x, y], outerRing)) {
          pixels.push({ x, y, value: Number(value) })
        }
      }
    }
  }
  
  // Log diagnostic info if no pixels found
  if (pixels.length === 0) {
    console.warn('No pixels found in polygon:', {
      polygonBounds: { minX: polyMinX, minY: polyMinY, maxX: polyMaxX, maxY: polyMaxY },
      rasterBounds: { minX, minY, maxX, maxY },
      pixelsChecked,
      pixelsInBounds,
      ringsCount: allRings.length,
      outerRingLength: allRings[0]?.length,
    })
  }
  
  return pixels
}

/**
 * Point-in-polygon test using ray casting algorithm
 */
function isPointInPolygon(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point
  let inside = false
  
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  
  return inside
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

