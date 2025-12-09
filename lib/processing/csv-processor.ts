/**
 * CSV File Processing
 * Extracts and validates data from CSV files
 */

import Papa from 'papaparse'

export interface CSVRow {
  [key: string]: any
}

export interface CSVProcessingResult {
  rows: CSVRow[]
  totalRows: number
  headers: string[]
  detectedFields: {
    pcode?: string
    name?: string
    population?: string
    adminLevel?: string
    [key: string]: string | undefined
  }
  availableAdminLevels?: number[] // Detected admin levels in the data
}

/**
 * Process CSV file and extract data
 * @param fileText - CSV file content as string
 * @param options - Optional processing options
 * @param options.filterAdminLevel - If provided, filter rows to only this admin level
 * @param options.pcodeColumn - Override pcode column detection with specific column name
 * @param options.filterTotalPopulationOnly - If true, filter to only rows with gender='all' and age_range='all' (for population datasets)
 */
export async function processCSVFile(
  fileText: string,
  options?: {
    filterAdminLevel?: number
    pcodeColumn?: string
    filterTotalPopulationOnly?: boolean
  }
): Promise<CSVProcessingResult> {
  const parseResult = Papa.parse<Record<string, any>>(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
    transform: (value: string) => value.trim() || null,
  })

  if (parseResult.errors && parseResult.errors.length > 0) {
    console.warn('CSV parsing warnings:', parseResult.errors)
  }

  // Get headers from first row
  const headers = parseResult.meta.fields || []

  let rows = parseResult.data.filter((row) => {
    // Filter out completely empty rows
    return Object.keys(row).length > 0 && Object.values(row).some((val) => val !== null && val !== '')
  })

  // Filter by admin level if requested
  if (options?.filterAdminLevel !== undefined) {
    // Try to detect admin_level column
    const adminLevelColumn = headers.find(h => 
      h.toLowerCase() === 'admin_level' || 
      h.toLowerCase() === 'adminlevel' ||
      (h.toLowerCase().includes('admin') && h.toLowerCase().includes('level'))
    )
    
    if (adminLevelColumn) {
      rows = rows.filter(row => {
        const rowLevel = row[adminLevelColumn]
        if (rowLevel === null || rowLevel === undefined || rowLevel === '') {
          return false
        }
        const levelNum = parseInt(String(rowLevel), 10)
        return !isNaN(levelNum) && levelNum === options.filterAdminLevel
      })
    }
  }

  // Filter to total population only (gender='all' and age_range='all') if requested
  if (options?.filterTotalPopulationOnly) {
    const genderColumn = headers.find(h => 
      h.toLowerCase() === 'gender' || h.toLowerCase() === 'sex'
    )
    const ageRangeColumn = headers.find(h => 
      h.toLowerCase() === 'age_range' || 
      h.toLowerCase() === 'agerange' ||
      (h.toLowerCase().includes('age') && h.toLowerCase().includes('range'))
    )

    if (genderColumn && ageRangeColumn) {
      rows = rows.filter(row => {
        const gender = String(row[genderColumn] || '').toLowerCase().trim()
        const ageRange = String(row[ageRangeColumn] || '').toLowerCase().trim()
        return gender === 'all' && ageRange === 'all'
      })
    } else {
      console.warn('filterTotalPopulationOnly requested but gender or age_range columns not found')
    }
  }

  // Detect common field patterns
  const detectedFields: CSVProcessingResult['detectedFields'] = {}
  const availableAdminLevels = new Set<number>()
  
  headers.forEach((header) => {
    const lowerHeader = header.toLowerCase()
    
    // Admin level detection
    if (!detectedFields.adminLevel) {
      if (
        lowerHeader === 'admin_level' ||
        lowerHeader === 'adminlevel' ||
        (lowerHeader.includes('admin') && lowerHeader.includes('level'))
      ) {
        detectedFields.adminLevel = header
      }
    }
  })

  // If admin level is specified, try to detect the appropriate pcode column for that level
  if (options?.filterAdminLevel !== undefined) {
    const level = options.filterAdminLevel
    // Try level-specific patterns first (e.g., admin1_code, admin2_code)
    const levelSpecificPcode = headers.find(h => {
      const lower = h.toLowerCase()
      return (
        lower === `admin${level}_code` ||
        lower === `adm${level}_code` ||
        lower === `admin${level}_pcode` ||
        lower === `adm${level}_pcode`
      )
    })
    
    if (levelSpecificPcode) {
      detectedFields.pcode = levelSpecificPcode
    }
  }

  // General pcode detection (fallback)
  if (!detectedFields.pcode || options?.pcodeColumn) {
    // Use override if provided
    if (options?.pcodeColumn && headers.includes(options.pcodeColumn)) {
      detectedFields.pcode = options.pcodeColumn
    } else {
      // Try general patterns
      headers.forEach((header) => {
        const lowerHeader = header.toLowerCase()
        if (!detectedFields.pcode) {
          if (
            lowerHeader.includes('pcode') ||
            (lowerHeader.includes('adm') && lowerHeader.includes('code')) ||
            lowerHeader === 'code' ||
            lowerHeader.includes('admin_code') ||
            lowerHeader === 'location_code' // HDX format
          ) {
            detectedFields.pcode = header
          }
        }
      })
    }
  }
  
  // Continue with name and population detection
  headers.forEach((header) => {
    const lowerHeader = header.toLowerCase()

    // Name detection
    if (!detectedFields.name) {
      if (
        lowerHeader.includes('name') ||
        (lowerHeader.includes('admin') && lowerHeader.includes('name')) ||
        lowerHeader === 'area' ||
        lowerHeader.includes('location')
      ) {
        detectedFields.name = header
      }
    }

    // Population detection
    if (!detectedFields.population) {
      if (
        lowerHeader.includes('pop') ||
        lowerHeader.includes('population') ||
        (lowerHeader.includes('total') && lowerHeader.includes('pop')) ||
        lowerHeader === 'people'
      ) {
        detectedFields.population = header
      }
    }
  })

  // Detect available admin levels if admin_level column exists
  if (detectedFields.adminLevel) {
    rows.forEach(row => {
      const levelValue = row[detectedFields.adminLevel!]
      if (levelValue !== null && levelValue !== undefined && levelValue !== '') {
        const levelNum = parseInt(String(levelValue), 10)
        if (!isNaN(levelNum)) {
          availableAdminLevels.add(levelNum)
        }
      }
    })
  }

  return {
    rows,
    totalRows: rows.length,
    headers,
    detectedFields,
    availableAdminLevels: availableAdminLevels.size > 0 ? Array.from(availableAdminLevels).sort((a, b) => a - b) : undefined,
  }
}

/**
 * Validate CSV data structure
 */
export function validateCSVData(result: CSVProcessingResult): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (result.totalRows === 0) {
    errors.push('CSV file contains no data rows')
  }

  if (result.headers.length === 0) {
    errors.push('CSV file has no column headers')
  }

  if (!result.detectedFields.pcode) {
    warnings.push('No pcode field detected. Expected fields: pcode, ADM*_PCODE, code, etc.')
  }

  if (!result.detectedFields.name) {
    warnings.push('No name field detected. Expected fields: name, ADM*_NAME, area, etc.')
  }

  if (!result.detectedFields.population) {
    warnings.push('No population field detected. Expected fields: population, pop, total_population, etc.')
  }

  // Check for duplicate pcodes if pcode field exists
  if (result.detectedFields.pcode) {
    const pcodes = result.rows
      .map((row) => row[result.detectedFields.pcode!])
      .filter((pcode) => pcode !== null && pcode !== '')
    
    const uniquePcodes = new Set(pcodes)
    if (pcodes.length !== uniquePcodes.size) {
      warnings.push(`Found ${pcodes.length - uniquePcodes.size} duplicate pcodes`)
    }
  }

  // Check for missing values
  if (result.detectedFields.pcode) {
    const missingPcodes = result.rows.filter(
      (row) => !row[result.detectedFields.pcode!] || row[result.detectedFields.pcode!] === ''
    ).length
    
    if (missingPcodes > 0) {
      warnings.push(`${missingPcodes} rows are missing pcodes`)
    }
  }

  if (result.detectedFields.population) {
    const missingPopulation = result.rows.filter(
      (row) => !row[result.detectedFields.population!] || 
               row[result.detectedFields.population!] === '' ||
               isNaN(Number(row[result.detectedFields.population!]))
    ).length
    
    if (missingPopulation > 0) {
      warnings.push(`${missingPopulation} rows are missing valid population values`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

