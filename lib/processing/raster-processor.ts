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
  const tiff = await fromArrayBuffer(fileBuffer)
  const image = await tiff.getImage()
  
  const [minX, minY, maxX, maxY] = image.getBoundingBox()
  const [pixelWidth, pixelHeight] = image.getResolution()
  
  const rasters = await image.readRasters()
  const dataType = rasters[0]?.constructor?.name || 'Float32'
  
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
    crs: image.geoKeys?.ProjectedCSTypeGeoKey?.toString() || image.geoKeys?.GeographicTypeGeoKey?.toString() || null,
    noDataValue: image.getGDALNoData() || null,
    dataType,
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
  const allRings: number[][] = []
  if (polygon.type === 'Polygon') {
    allRings.push(...polygon.coordinates)
  } else {
    // MultiPolygon: flatten all rings
    for (const poly of polygon.coordinates as number[][][]) {
      allRings.push(...poly)
    }
  }
  
  // Get bounding box of polygon for optimization
  let polyMinX = Infinity, polyMinY = Infinity, polyMaxX = -Infinity, polyMaxY = -Infinity
  for (const ring of allRings) {
    for (const [lon, lat] of ring) {
      polyMinX = Math.min(polyMinX, lon)
      polyMinY = Math.min(polyMinY, lat)
      polyMaxX = Math.max(polyMaxX, lon)
      polyMaxY = Math.max(polyMaxY, lat)
    }
  }
  
  // Iterate through pixels that intersect with polygon bounds
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      // Calculate pixel center coordinates
      const x = minX + (col + 0.5) * pixelWidth
      const y = maxY - (row + 0.5) * pixelHeight // Y is top-down in rasters
      
      // Quick bounds check
      if (x < polyMinX || x > polyMaxX || y < polyMinY || y > polyMaxY) {
        continue
      }
      
      const value = data[row * width + col]
      
      // Skip no-data values
      if (noDataValue !== null && value === noDataValue) {
        continue
      }
      
      // Check if point is inside polygon (point-in-polygon test)
      if (isPointInPolygon([x, y], allRings[0])) {
        pixels.push({ x, y, value: Number(value) })
      }
    }
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

