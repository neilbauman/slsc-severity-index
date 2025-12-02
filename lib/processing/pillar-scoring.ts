/**
 * Pillar Scoring Engine
 * Calculates pillar scores for households based on analysis grid mappings
 */

import { CalculationModelConfig, AnalysisGridMapping } from './ssc-template-parser'
import { HouseholdRecord } from './household-processor'

export interface PillarScores {
  pillar1: number | null
  pillar2: number | null
  pillar3: number | null
  subIndicatorScores?: {
    pillar1: {
      '1.1'?: number
      '1.2'?: number
      '1.3'?: number
      '1.4'?: number
    }
    pillar2: {
      '2.1'?: number
      '2.2'?: number
      '2.3'?: number
      '2.4'?: number
      '2.5'?: number
      '2.6'?: number
    }
    pillar3: Record<string, number>
  }
}

export interface ScoringResult {
  scores: PillarScores
  appliedRules: string[]
  warnings: string[]
}

/**
 * Normalize string value for comparison
 */
function normalizeValue(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value).trim().toLowerCase()
  return str
}

/**
 * Check if a response value matches a condition
 */
function matchesCondition(responseValue: any, condition: string): boolean {
  const normalizedResponse = normalizeValue(responseValue)
  const normalizedCondition = normalizeValue(condition)

  // Exact match
  if (normalizedResponse === normalizedCondition) {
    return true
  }

  // Check if condition contains the response (for multi-value conditions)
  if (normalizedCondition.includes(normalizedResponse)) {
    return true
  }

  // Check if response contains the condition (for partial matches)
  if (normalizedResponse.includes(normalizedCondition)) {
    return true
  }

  // Handle numeric comparisons if both are numeric
  const responseNum = parseFloat(normalizedResponse)
  const conditionNum = parseFloat(normalizedCondition)
  if (!isNaN(responseNum) && !isNaN(conditionNum)) {
    return responseNum === conditionNum
  }

  return false
}

/**
 * Check if any of the response values match any of the conditions
 */
function matchesAnyCondition(
  surveyResponses: Record<string, any>,
  questionMappings: AnalysisGridMapping['questionMappings'],
  conditions: string[]
): boolean {
  for (const mapping of questionMappings) {
    const responseValue = surveyResponses[mapping.questionField]
    if (responseValue !== undefined && responseValue !== null) {
      // Check against all response values in mapping
      for (const expectedResponse of mapping.responseValues) {
        if (matchesCondition(responseValue, expectedResponse)) {
          // Also check if this matches any condition
          for (const condition of conditions) {
            if (matchesCondition(responseValue, condition) || matchesCondition(expectedResponse, condition)) {
              return true
            }
          }
        }
      }

      // Direct check against conditions
      for (const condition of conditions) {
        if (matchesCondition(responseValue, condition)) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Calculate score for a single sub-indicator
 */
function calculateSubIndicatorScore(
  household: HouseholdRecord,
  model: CalculationModelConfig,
  subIndicatorNumber: string,
  pillarNumber: number
): number | null {
  // Find all mappings for this sub-indicator
  const mappings = model.analysisGrid.filter(
    m => m.pillarNumber === pillarNumber && m.subIndicatorNumber === subIndicatorNumber
  )

  if (mappings.length === 0) {
    return null
  }

  // Sort by score value (descending - try highest scores first)
  const sortedMappings = [...mappings].sort((a, b) => {
    const scoreA = typeof a.scoreValue === 'number' ? a.scoreValue : 0
    const scoreB = typeof b.scoreValue === 'number' ? b.scoreValue : 0
    return scoreB - scoreA
  })

  // Try each mapping in order
  for (const mapping of sortedMappings) {
    // Check if household responses match this mapping's conditions
    const matches = matchesAnyCondition(
      household.survey_responses,
      mapping.questionMappings,
      mapping.responseConditions || []
    )

    if (matches) {
      // Return the score value
      if (typeof mapping.scoreValue === 'number') {
        return mapping.scoreValue
      }
      // Handle special cases like "One of the three scores"
      if (typeof mapping.scoreValue === 'string') {
        // If it says to take one of multiple scores, we'll return null and handle aggregation differently
        // For now, return 0 for these cases
        return 0
      }
    }
  }

  // No match found - return null (missing data)
  return null
}

/**
 * Aggregate sub-indicator scores into pillar score
 * For Pillar 1: Start from 1, add sub-indicator scores, cap at 5
 * For Pillar 2 and 3: Different aggregation logic may apply
 */
function aggregatePillarScore(
  subIndicatorScores: Record<string, number | null>,
  pillarNumber: number
): number {
  const scores = Object.values(subIndicatorScores).filter(s => s !== null) as number[]

  if (scores.length === 0) {
    return 0 // No data
  }

  if (pillarNumber === 1) {
    // Pillar 1: Start from 1, add scores, cap at 5
    let total = 1
    for (const score of scores) {
      total += score
    }
    return Math.min(5, Math.max(1, Math.round(total)))
  } else {
    // Pillar 2 and 3: Sum scores, then determine severity level
    // Based on typical SSC methodology: sum all sub-indicator issues
    const sum = scores.reduce((a, b) => a + b, 0)

    // Convert sum to 1-5 scale
    // This is a simplified approach - actual logic may vary
    if (sum >= 3) return 5
    if (sum >= 2) return 4
    if (sum >= 1) return 3
    if (sum > 0) return 2
    return 1
  }
}

/**
 * Calculate all pillar scores for a household
 */
export function calculatePillarScores(
  household: HouseholdRecord,
  model: CalculationModelConfig
): ScoringResult {
  const warnings: string[] = []
  const appliedRules: string[] = []
  const subIndicatorScores: PillarScores['subIndicatorScores'] = {
    pillar1: {},
    pillar2: {},
    pillar3: {},
  }

  // Calculate Pillar 1 scores (Shelter)
  const pillar1SubIndicators = ['1.1', '1.2', '1.3', '1.4']
  for (const subIndicator of pillar1SubIndicators) {
    const score = calculateSubIndicatorScore(household, model, subIndicator, 1)
    if (score !== null) {
      subIndicatorScores.pillar1[subIndicator as keyof typeof subIndicatorScores.pillar1] = score
      appliedRules.push(`Pillar 1, Sub-indicator ${subIndicator}: ${score}`)
    }
  }

  // Calculate Pillar 2 scores (NFI/Domestic functions)
  const pillar2SubIndicators = ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6']
  for (const subIndicator of pillar2SubIndicators) {
    const score = calculateSubIndicatorScore(household, model, subIndicator, 2)
    if (score !== null) {
      subIndicatorScores.pillar2[subIndicator as keyof typeof subIndicatorScores.pillar2] = score
      appliedRules.push(`Pillar 2, Sub-indicator ${subIndicator}: ${score}`)
    }
  }

  // Calculate Pillar 3 scores (Services)
  // Pillar 3 sub-indicators may vary by context, so we find them dynamically
  const pillar3SubIndicators = new Set(
    model.analysisGrid
      .filter(m => m.pillarNumber === 3)
      .map(m => m.subIndicatorNumber)
  )

  for (const subIndicator of pillar3SubIndicators) {
    const score = calculateSubIndicatorScore(household, model, subIndicator, 3)
    if (score !== null) {
      subIndicatorScores.pillar3[subIndicator] = score
      appliedRules.push(`Pillar 3, Sub-indicator ${subIndicator}: ${score}`)
    }
  }

  // Aggregate pillar scores
  const pillar1Score = aggregatePillarScore(
    subIndicatorScores.pillar1 as Record<string, number | null>,
    1
  )
  const pillar2Score = aggregatePillarScore(
    subIndicatorScores.pillar2 as Record<string, number | null>,
    2
  )
  const pillar3Score = aggregatePillarScore(
    subIndicatorScores.pillar3,
    3
  )

  // Warn if we couldn't calculate all sub-indicators
  const missingPillar1 = pillar1SubIndicators.filter(
    si => subIndicatorScores.pillar1[si as keyof typeof subIndicatorScores.pillar1] === undefined
  )
  if (missingPillar1.length > 0) {
    warnings.push(`Missing data for Pillar 1 sub-indicators: ${missingPillar1.join(', ')}`)
  }

  const missingPillar2 = pillar2SubIndicators.filter(
    si => subIndicatorScores.pillar2[si as keyof typeof subIndicatorScores.pillar2] === undefined
  )
  if (missingPillar2.length > 0) {
    warnings.push(`Missing data for Pillar 2 sub-indicators: ${missingPillar2.join(', ')}`)
  }

  return {
    scores: {
      pillar1: pillar1Score,
      pillar2: pillar2Score,
      pillar3: pillar3Score,
      subIndicatorScores,
    },
    appliedRules,
    warnings,
  }
}

/**
 * Batch calculate pillar scores for multiple households
 */
export function calculatePillarScoresBatch(
  households: HouseholdRecord[],
  model: CalculationModelConfig
): Map<string, ScoringResult> {
  const results = new Map<string, ScoringResult>()

  for (const household of households) {
    const householdKey = household.household_id || household.pcode || `household_${results.size}`
    const scoringResult = calculatePillarScores(household, model)
    results.set(householdKey, scoringResult)
  }

  return results
}

