/**
 * Household Dataset Processor
 * Processes household-level survey datasets and links them to admin boundaries
 */

import { processExcelFile, ExcelProcessingResult } from './excel-processor'
import { processCSVFile } from './csv-processor'

export interface HouseholdRecord {
  household_id?: string
  pcode?: string
  admin1?: string
  admin2?: string
  admin3?: string
  admin1_pcode?: string
  admin2_pcode?: string
  admin3_pcode?: string
  population_group?: string
  survey_responses: Record<string, any>
}

export interface HouseholdProcessingResult {
  records: HouseholdRecord[]
  totalRecords: number
  matchedBoundaries: number
  unmatchedPcodes: string[]
  errors: string[]
  warnings: string[]
  detectedFields: {
    pcode?: string
    householdId?: string
    populationGroup?: string
    admin1?: string
    admin2?: string
    admin3?: string
  }
}

/**
 * Detect field names that might contain pcode information
 */
function detectPcodeField(headers: string[]): string | null {
  const patterns = [
    /pcode/i,
    /p_code/i,
    /admin.*code/i,
    /adm\d+.*code/i,
    /admin\d+.*pcode/i,
  ]

  for (const header of headers) {
    for (const pattern of patterns) {
      if (pattern.test(header)) {
        return header
      }
    }
  }

  return null
}

/**
 * Detect household ID field
 */
function detectHouseholdIdField(headers: string[]): string | null {
  const patterns = [
    /household.*id/i,
    /hh.*id/i,
    /hhid/i,
    /id$/i,
  ]

  for (const header of headers) {
    for (const pattern of patterns) {
      if (pattern.test(header) && !pattern.test('pcode')) {
        return header
      }
    }
  }

  return null
}

/**
 * Detect population group field
 */
function detectPopulationGroupField(headers: string[]): string | null {
  const patterns = [
    /population.*group/i,
    /pop.*group/i,
    /group/i,
    /displacement.*status/i,
    /displacement.*type/i,
  ]

  for (const header of headers) {
    for (const pattern of patterns) {
      if (pattern.test(header)) {
        return header
      }
    }
  }

  return null
}

/**
 * Detect admin level fields
 */
function detectAdminFields(headers: string[]): {
  admin1?: string
  admin2?: string
  admin3?: string
  admin1Pcode?: string
  admin2Pcode?: string
  admin3Pcode?: string
} {
  const result: {
    admin1?: string
    admin2?: string
    admin3?: string
    admin1Pcode?: string
    admin2Pcode?: string
    admin3Pcode?: string
  } = {}

  for (const header of headers) {
    const lowerHeader = header.toLowerCase()

    // Admin level 1
    if ((lowerHeader.includes('admin1') || lowerHeader.includes('adm1')) && !lowerHeader.includes('code')) {
      result.admin1 = header
    }
    if ((lowerHeader.includes('admin1') || lowerHeader.includes('adm1')) && lowerHeader.includes('code')) {
      result.admin1Pcode = header
    }

    // Admin level 2
    if ((lowerHeader.includes('admin2') || lowerHeader.includes('adm2')) && !lowerHeader.includes('code')) {
      result.admin2 = header
    }
    if ((lowerHeader.includes('admin2') || lowerHeader.includes('adm2')) && lowerHeader.includes('code')) {
      result.admin2Pcode = header
    }

    // Admin level 3
    if ((lowerHeader.includes('admin3') || lowerHeader.includes('adm3')) && !lowerHeader.includes('code')) {
      result.admin3 = header
    }
    if ((lowerHeader.includes('admin3') || lowerHeader.includes('adm3')) && lowerHeader.includes('code')) {
      result.admin3Pcode = header
    }
  }

  return result
}

/**
 * Extract pcode from row - tries multiple strategies
 */
function extractPcode(row: Record<string, any>, detectedFields: HouseholdProcessingResult['detectedFields']): string | null {
  // Priority 1: Admin3 pcode (most specific)
  if (detectedFields.admin3 && row[detectedFields.admin3]) {
    return String(row[detectedFields.admin3]).trim() || null
  }

  // Priority 2: Admin2 pcode
  if (detectedFields.admin2 && row[detectedFields.admin2]) {
    return String(row[detectedFields.admin2]).trim() || null
  }

  // Priority 3: Admin1 pcode
  if (detectedFields.admin1 && row[detectedFields.admin1]) {
    return String(row[detectedFields.admin1]).trim() || null
  }

  // Priority 4: Generic pcode field
  if (detectedFields.pcode && row[detectedFields.pcode]) {
    return String(row[detectedFields.pcode]).trim() || null
  }

  return null
}

/**
 * Process household dataset from Excel file
 */
export async function processHouseholdExcel(
  fileBuffer: ArrayBuffer
): Promise<HouseholdProcessingResult> {
  const excelResult = await processExcelFile(fileBuffer)

  return processHouseholdData(excelResult.rows, excelResult.headers)
}

/**
 * Process household dataset from CSV file
 */
export async function processHouseholdCSV(
  csvText: string
): Promise<HouseholdProcessingResult> {
  const csvResult = processCSVFile(csvText)

  return processHouseholdData(csvResult.rows, csvResult.headers)
}

/**
 * Process household data rows
 */
function processHouseholdData(
  rows: Record<string, any>[],
  headers: string[]
): HouseholdProcessingResult {
  const records: HouseholdRecord[] = []
  const unmatchedPcodes = new Set<string>()
  const errors: string[] = []
  const warnings: string[] = []

  // Detect field names
  const pcodeField = detectPcodeField(headers)
  const householdIdField = detectHouseholdIdField(headers)
  const populationGroupField = detectPopulationGroupField(headers)
  const adminFields = detectAdminFields(headers)

  const detectedFields: HouseholdProcessingResult['detectedFields'] = {
    pcode: pcodeField || undefined,
    householdId: householdIdField || undefined,
    populationGroup: populationGroupField || undefined,
    admin1: adminFields.admin1,
    admin2: adminFields.admin2,
    admin3: adminFields.admin3,
  }

  // Warn if no pcode field detected
  if (!pcodeField && !adminFields.admin1Pcode && !adminFields.admin2Pcode && !adminFields.admin3Pcode) {
    warnings.push('No pcode field detected. Households will not be linked to admin boundaries.')
  }

  // Process each row
  for (const row of rows) {
    try {
      const pcode = extractPcode(row, detectedFields)

      // Skip rows without pcode (but don't error - might be header or summary rows)
      if (!pcode) {
        continue
      }

      // Extract all survey responses
      const surveyResponses: Record<string, any> = {}
      for (const header of headers) {
        if (row[header] !== undefined && row[header] !== null && row[header] !== '') {
          surveyResponses[header] = row[header]
        }
      }

      const householdRecord: HouseholdRecord = {
        household_id: householdIdField ? String(row[householdIdField] || '').trim() : undefined,
        pcode: pcode,
        admin1: adminFields.admin1 ? String(row[adminFields.admin1] || '').trim() : undefined,
        admin2: adminFields.admin2 ? String(row[adminFields.admin2] || '').trim() : undefined,
        admin3: adminFields.admin3 ? String(row[adminFields.admin3] || '').trim() : undefined,
        admin1_pcode: adminFields.admin1Pcode ? String(row[adminFields.admin1Pcode] || '').trim() : undefined,
        admin2_pcode: adminFields.admin2Pcode ? String(row[adminFields.admin2Pcode] || '').trim() : undefined,
        admin3_pcode: adminFields.admin3Pcode ? String(row[adminFields.admin3Pcode] || '').trim() : undefined,
        population_group: populationGroupField ? String(row[populationGroupField] || '').trim() : undefined,
        survey_responses: surveyResponses,
      }

      records.push(householdRecord)
    } catch (error: any) {
      errors.push(`Error processing row: ${error.message}`)
    }
  }

  return {
    records,
    totalRecords: records.length,
    matchedBoundaries: 0, // Will be updated when linking to admin boundaries
    unmatchedPcodes: Array.from(unmatchedPcodes),
    errors,
    warnings,
    detectedFields,
  }
}

/**
 * Validate household dataset
 */
export function validateHouseholdDataset(result: HouseholdProcessingResult): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (result.totalRecords === 0) {
    errors.push('No household records found in dataset')
  }

  if (result.errors.length > 0) {
    errors.push(...result.errors)
  }

  if (result.warnings.length > 0) {
    warnings.push(...result.warnings)
  }

  // Check for records without pcodes
  const recordsWithoutPcode = result.records.filter(r => !r.pcode).length
  if (recordsWithoutPcode > 0) {
    warnings.push(`${recordsWithoutPcode} records are missing pcodes and will not be linked to admin boundaries`)
  }

  // Check for duplicate household IDs
  if (result.records.some(r => r.household_id)) {
    const householdIds = result.records
      .map(r => r.household_id)
      .filter(id => id) as string[]
    const uniqueIds = new Set(householdIds)
    if (householdIds.length !== uniqueIds.size) {
      warnings.push(`Found ${householdIds.length - uniqueIds.size} duplicate household IDs`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

