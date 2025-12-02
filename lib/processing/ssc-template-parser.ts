/**
 * SSC Calculation Template Parser
 * Extracts calculation methodology from SSC Excel calculation templates
 */

import * as XLSX from 'xlsx'

export interface CoreIndicator {
  pillar: string
  pillarNumber: number
  indicator: string
  subIndicator: string
  subIndicatorNumber: string
}

export interface AnalysisGridMapping {
  pillar: string
  pillarNumber: number
  indicator: string
  subIndicator: string
  subIndicatorNumber: string
  criteria: string
  scoreValue: number | string
  scoringNote?: string
  questionMappings: {
    questionField: string
    responseValues: string[]
  }[]
  responseConditions?: string[]
}

export interface DecisionTreeRule {
  pillar1: number
  pillar2: number
  pillar3: number
  finalScore: number
  rationale?: string
}

export interface CalculationModelConfig {
  name: string
  version: string
  description?: string
  coreIndicators: CoreIndicator[]
  analysisGrid: AnalysisGridMapping[]
  decisionTree: DecisionTreeRule[]
  metadata?: {
    sourceFile?: string
    country?: string
    context?: string
    parsedAt: string
  }
}

/**
 * Parse Core Indicators sheet
 */
function parseCoreIndicators(workbook: XLSX.WorkBook): CoreIndicator[] {
  const sheetName = 'Core indicators'
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`)
  }

  const ws = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]

  const indicators: CoreIndicator[] = []
  let currentPillar = ''
  let currentPillarNumber = 0
  let currentIndicator = ''

  // Start from row 3 (0-indexed row 3, which is row 4 in Excel)
  for (let i = 3; i < data.length; i++) {
    const row = data[i]
    const pillar = String(row[0] || '').trim()
    const indicator = String(row[1] || '').trim()
    const subIndicator = String(row[2] || '').trim()

    if (pillar && pillar.startsWith('Pillar')) {
      currentPillar = pillar
      // Extract pillar number (1, 2, or 3)
      const pillarMatch = pillar.match(/Pillar\s*(\d+)/i)
      currentPillarNumber = pillarMatch ? parseInt(pillarMatch[1]) : 0
    }

    if (indicator && indicator.includes('Ind ')) {
      currentIndicator = indicator
    }

    if (subIndicator && subIndicator.includes('Ind ')) {
      // Extract sub-indicator number (e.g., "Ind 1.1" -> "1.1")
      const subIndicatorMatch = subIndicator.match(/Ind\s*(\d+\.\d+)/i)
      const subIndicatorNumber = subIndicatorMatch ? subIndicatorMatch[1] : ''

      if (currentPillar && currentIndicator && subIndicator && subIndicatorNumber) {
        indicators.push({
          pillar: currentPillar,
          pillarNumber: currentPillarNumber,
          indicator: currentIndicator,
          subIndicator: subIndicator,
          subIndicatorNumber: subIndicatorNumber,
        })
      }
    }
  }

  return indicators
}

/**
 * Parse Analysis Grid sheet
 */
function parseAnalysisGrid(workbook: XLSX.WorkBook): AnalysisGridMapping[] {
  const sheetName = 'Analysis grid'
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`)
  }

  const ws = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]

  const mappings: AnalysisGridMapping[] = []
  let currentPillar = ''
  let currentPillarNumber = 0
  let currentIndicator = ''
  let currentSubIndicator = ''
  let currentSubIndicatorNumber = ''
  let questionHeaders: string[] = []

  // Get question headers from row 4 (index 4)
  if (data.length > 4) {
    questionHeaders = data[4].slice(5).filter((v: any) => v && String(v).trim())
  }

  // Start from row 6 (0-indexed row 6)
  for (let i = 5; i < data.length; i++) {
    const row = data[i]
    const pillar = String(row[0] || '').trim()
    const indicator = String(row[1] || '').trim()
    const subIndicator = String(row[2] || '').trim()
    const criteria = String(row[3] || '').trim()
    const scoreCalculation = row[4] !== undefined ? row[4] : ''
    const analysisGridStart = 5 // Questions start at column index 5

    // Update current context
    if (pillar && pillar.startsWith('Pillar')) {
      currentPillar = pillar
      const pillarMatch = pillar.match(/Pillar\s*(\d+)/i)
      currentPillarNumber = pillarMatch ? parseInt(pillarMatch[1]) : 0
    }

    if (indicator && indicator.includes('Ind ')) {
      currentIndicator = indicator
    }

    if (subIndicator && subIndicator.includes('Ind ')) {
      currentSubIndicator = subIndicator
      const subIndicatorMatch = subIndicator.match(/Ind\s*(\d+\.\d+)/i)
      currentSubIndicatorNumber = subIndicatorMatch ? subIndicatorMatch[1] : ''
    }

      // If we have criteria and score, create a mapping
      if (criteria && scoreCalculation !== '' && currentSubIndicator) {
        // Parse score value (could be number or string like "One of the three scores")
        let scoreValue: number | string = scoreCalculation
        let numMatch: RegExpMatchArray | null = null
        if (typeof scoreCalculation === 'number') {
          scoreValue = scoreCalculation
        } else if (typeof scoreCalculation === 'string') {
          numMatch = String(scoreCalculation).match(/(\d+\.?\d*)/)
          if (numMatch) {
            scoreValue = parseFloat(numMatch[1])
          }
        }

      // Extract question mappings from remaining columns
      const questionMappings: AnalysisGridMapping['questionMappings'] = []
      const responseConditions: string[] = []

      for (let j = analysisGridStart; j < row.length && j - analysisGridStart < questionHeaders.length; j++) {
        const cellValue = row[j]
        if (cellValue && String(cellValue).trim()) {
          const questionField = questionHeaders[j - analysisGridStart]
          const responseValue = String(cellValue).trim()

          // Check if this question field already exists
          const existingMapping = questionMappings.find(m => m.questionField === questionField)
          if (existingMapping) {
            existingMapping.responseValues.push(responseValue)
          } else {
            questionMappings.push({
              questionField: questionField || `Column_${j}`,
              responseValues: [responseValue],
            })
          }

          responseConditions.push(responseValue)
        }
      }

      mappings.push({
        pillar: currentPillar,
        pillarNumber: currentPillarNumber,
        indicator: currentIndicator,
        subIndicator: currentSubIndicator,
        subIndicatorNumber: currentSubIndicatorNumber,
        criteria: criteria,
        scoreValue: scoreValue,
        scoringNote: typeof scoreCalculation === 'string' && !numMatch ? String(scoreCalculation) : undefined,
        questionMappings: questionMappings,
        responseConditions: responseConditions.length > 0 ? responseConditions : undefined,
      })
    }
  }

  return mappings
}

/**
 * Parse Decision Tree sheet
 */
function parseDecisionTree(workbook: XLSX.WorkBook): DecisionTreeRule[] {
  const sheetName = 'Decision-tree'
  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`)
  }

  const ws = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]

  const rules: DecisionTreeRule[] = []

  // Find header row (usually row 4, index 4)
  let headerRowIndex = -1
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const row = data[i]
    if (row && row[0] && String(row[0]).includes('Pillar 1')) {
      headerRowIndex = i
      break
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not find decision tree header row')
  }

  // Parse data rows starting after header
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i]
    const pillar1 = row[0]
    const pillar2 = row[1]
    const pillar3 = row[2]
    const finalScore = row[3]
    const rationale = row[4] ? String(row[4]).trim() : undefined

    // Validate that we have numeric values
    if (
      typeof pillar1 === 'number' &&
      typeof pillar2 === 'number' &&
      typeof pillar3 === 'number' &&
      typeof finalScore === 'number'
    ) {
      rules.push({
        pillar1: pillar1,
        pillar2: pillar2,
        pillar3: pillar3,
        finalScore: finalScore,
        rationale: rationale,
      })
    }
  }

  return rules
}

/**
 * Parse SSC calculation template from Excel file
 */
export async function parseSSCTemplate(
  fileBuffer: ArrayBuffer,
  options?: {
    name?: string
    version?: string
    description?: string
    country?: string
    context?: string
  }
): Promise<CalculationModelConfig> {
  const workbook = XLSX.read(fileBuffer, { type: 'array' })

  // Parse all components
  const coreIndicators = parseCoreIndicators(workbook)
  const analysisGrid = parseAnalysisGrid(workbook)
  const decisionTree = parseDecisionTree(workbook)

  // Generate name and version from filename if not provided
  const name = options?.name || 'SSC Calculation Model'
  const version = options?.version || '1.0.0'

  // Validate parsed data
  if (coreIndicators.length === 0) {
    throw new Error('No core indicators found in template')
  }

  if (analysisGrid.length === 0) {
    throw new Error('No analysis grid mappings found in template')
  }

  if (decisionTree.length === 0) {
    throw new Error('No decision tree rules found in template')
  }

  return {
    name,
    version,
    description: options?.description,
    coreIndicators,
    analysisGrid,
    decisionTree,
    metadata: {
      country: options?.country,
      context: options?.context,
      parsedAt: new Date().toISOString(),
    },
  }
}

/**
 * Validate parsed calculation model config
 */
export function validateCalculationModelConfig(config: CalculationModelConfig): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (!config.name) {
    errors.push('Calculation model name is required')
  }

  if (!config.version) {
    errors.push('Calculation model version is required')
  }

  if (config.coreIndicators.length === 0) {
    errors.push('No core indicators defined')
  }

  // Check for all 3 pillars
  const pillarNumbers = new Set(config.coreIndicators.map(i => i.pillarNumber))
  if (!pillarNumbers.has(1) || !pillarNumbers.has(2) || !pillarNumbers.has(3)) {
    warnings.push('Missing one or more pillars. Expected Pillar 1, 2, and 3.')
  }

  if (config.analysisGrid.length === 0) {
    errors.push('No analysis grid mappings defined')
  }

  if (config.decisionTree.length === 0) {
    errors.push('No decision tree rules defined')
  }

  // Validate decision tree has reasonable coverage
  if (config.decisionTree.length < 10) {
    warnings.push('Decision tree has relatively few rules. May not cover all combinations.')
  }

  // Check for missing question mappings
  const mappingsWithoutQuestions = config.analysisGrid.filter(
    m => m.questionMappings.length === 0
  )
  if (mappingsWithoutQuestions.length > 0) {
    warnings.push(`${mappingsWithoutQuestions.length} analysis grid mappings have no question mappings`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

