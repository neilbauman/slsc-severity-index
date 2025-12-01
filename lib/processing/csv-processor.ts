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
    [key: string]: string | undefined
  }
}

/**
 * Process CSV file and extract data
 */
export async function processCSVFile(fileText: string): Promise<CSVProcessingResult> {
  const parseResult = Papa.parse<Record<string, any>>(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
    transform: (value: string) => value.trim() || null,
  })

  if (parseResult.errors && parseResult.errors.length > 0) {
    console.warn('CSV parsing warnings:', parseResult.errors)
  }

  const rows = parseResult.data.filter((row) => {
    // Filter out completely empty rows
    return Object.keys(row).length > 0 && Object.values(row).some((val) => val !== null && val !== '')
  })

  // Get headers from first row
  const headers = parseResult.meta.fields || []

  // Detect common field patterns
  const detectedFields: CSVProcessingResult['detectedFields'] = {}
  
  headers.forEach((header) => {
    const lowerHeader = header.toLowerCase()
    
    // Pcode detection
    if (!detectedFields.pcode) {
      if (
        lowerHeader.includes('pcode') ||
        (lowerHeader.includes('adm') && lowerHeader.includes('code')) ||
        lowerHeader === 'code' ||
        lowerHeader.includes('admin_code')
      ) {
        detectedFields.pcode = header
      }
    }

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

  return {
    rows,
    totalRows: rows.length,
    headers,
    detectedFields,
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

