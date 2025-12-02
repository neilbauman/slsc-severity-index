/**
 * Severity Calculation Engine
 * Applies decision tree logic and aggregates to area-level with 20% rule
 */

import { CalculationModelConfig, DecisionTreeRule } from './ssc-template-parser'
import { HouseholdRecord } from './household-processor'
import { PillarScores, calculatePillarScores } from './pillar-scoring'

export interface HouseholdSeverity {
  household_id?: string
  pcode: string
  pillarScores: PillarScores
  finalSeverity: number
  population_group?: string
}

export interface AreaSeverityResult {
  admin_boundary_id: string
  pcode: string
  admin_level: number
  name: string
  total_households: number
  severity_distribution: {
    phase1: number
    phase2: number
    phase3: number
    phase4: number
    phase5: number
  }
  severity_proportions: {
    phase1: number
    phase2: number
    phase3: number
    phase4: number
    phase5: number
  }
  area_severity: number // Final area severity (1-5)
  pin_count: number // People in Need (phases 3, 4, 5)
  population_group?: string
}

export interface CalculationResult {
  householdSeverities: HouseholdSeverity[]
  areaSeverities: AreaSeverityResult[]
  summary: {
    total_households: number
    total_areas: number
    total_pin: number
    severity_breakdown: {
      phase1: number
      phase2: number
      phase3: number
      phase4: number
      phase5: number
    }
  }
}

/**
 * Apply decision tree to determine final severity from pillar scores
 */
function applyDecisionTree(
  pillarScores: PillarScores,
  decisionTree: DecisionTreeRule[]
): number {
  const pillar1 = pillarScores.pillar1 || 1
  const pillar2 = pillarScores.pillar2 || 1
  const pillar3 = pillarScores.pillar3 || 1

  // Find matching rule (exact match)
  const exactMatch = decisionTree.find(
    rule =>
      rule.pillar1 === pillar1 &&
      rule.pillar2 === pillar2 &&
      rule.pillar3 === pillar3
  )

  if (exactMatch) {
    return exactMatch.finalScore
  }

  // If no exact match, find closest match (prioritize Pillar 1)
  // Try matching with closest values
  const sortedRules = [...decisionTree].sort((a, b) => {
    // Prioritize rules with matching Pillar 1
    if (a.pillar1 === pillar1 && b.pillar1 !== pillar1) return -1
    if (b.pillar1 === pillar1 && a.pillar1 !== pillar1) return 1
    // Then prioritize matching Pillar 2
    if (a.pillar2 === pillar2 && b.pillar2 !== pillar2) return -1
    if (b.pillar2 === pillar2 && a.pillar2 !== pillar2) return 1
    // Then prioritize matching Pillar 3
    if (a.pillar3 === pillar3 && b.pillar3 !== pillar3) return -1
    if (b.pillar3 === pillar3 && a.pillar3 !== pillar3) return 1
    return 0
  })

  if (sortedRules.length > 0) {
    // Use the first (most closely matching) rule
    return sortedRules[0].finalScore
  }

  // Fallback: use Pillar 1 score as final severity
  return Math.max(1, Math.min(5, Math.round(pillar1)))
}

/**
 * Calculate final severity for a single household
 */
function calculateHouseholdSeverity(
  household: HouseholdRecord,
  pillarScores: PillarScores,
  model: CalculationModelConfig
): HouseholdSeverity {
  const finalSeverity = applyDecisionTree(pillarScores, model.decisionTree)

  return {
    household_id: household.household_id,
    pcode: household.pcode || '',
    pillarScores,
    finalSeverity,
    population_group: household.population_group,
  }
}

/**
 * Calculate severity distribution for an area
 */
function calculateAreaSeverity(
  householdSeverities: HouseholdSeverity[],
  areaPcode: string,
  areaName: string,
  areaLevel: number,
  totalPopulation: number = 0,
  populationGroup?: string
): AreaSeverityResult {
  // Filter households for this area
  const areaHouseholds = householdSeverities.filter(
    h => h.pcode === areaPcode && (!populationGroup || h.population_group === populationGroup)
  )

  const totalHouseholds = areaHouseholds.length

  // Count households by severity phase
  const severityDistribution = {
    phase1: 0,
    phase2: 0,
    phase3: 0,
    phase4: 0,
    phase5: 0,
  }

  for (const household of areaHouseholds) {
    const severity = household.finalSeverity
    if (severity >= 1 && severity <= 5) {
      severityDistribution[`phase${severity}` as keyof typeof severityDistribution]++
    }
  }

  // Calculate proportions
  const proportions = {
    phase1: totalHouseholds > 0 ? severityDistribution.phase1 / totalHouseholds : 0,
    phase2: totalHouseholds > 0 ? severityDistribution.phase2 / totalHouseholds : 0,
    phase3: totalHouseholds > 0 ? severityDistribution.phase3 / totalHouseholds : 0,
    phase4: totalHouseholds > 0 ? severityDistribution.phase4 / totalHouseholds : 0,
    phase5: totalHouseholds > 0 ? severityDistribution.phase5 / totalHouseholds : 0,
  }

  // Apply 20% rule: highest severity where cumulative proportion >= 20%
  let areaSeverity = 1
  let cumulativeProportion = 0

  // Check from highest to lowest severity
  for (let phase = 5; phase >= 1; phase--) {
    cumulativeProportion += proportions[`phase${phase}` as keyof typeof proportions]
    if (cumulativeProportion >= 0.2) {
      areaSeverity = phase
      break
    }
  }

  // Calculate PIN (People in Need) = phases 3, 4, and 5
  const pinProportion = proportions.phase3 + proportions.phase4 + proportions.phase5
  const pinCount = Math.round(totalPopulation * pinProportion)

  return {
    admin_boundary_id: '', // Will be filled when linking to admin boundaries
    pcode: areaPcode,
    admin_level: areaLevel,
    name: areaName,
    total_households: totalHouseholds,
    severity_distribution: severityDistribution,
    severity_proportions: proportions,
    area_severity: areaSeverity,
    pin_count: pinCount,
    population_group: populationGroup,
  }
}

/**
 * Run complete severity calculation
 */
export async function calculateSeverity(
  households: HouseholdRecord[],
  model: CalculationModelConfig,
  options?: {
    adminBoundaries?: Array<{
      id: string
      pcode: string
      name: string
      level: number
    }>
    populationData?: Array<{
      pcode: string
      population: number
      population_group?: string
    }>
    populationGroups?: string[]
  }
): Promise<CalculationResult> {
  // Step 1: Calculate pillar scores for all households
  const householdSeverities: HouseholdSeverity[] = []

  for (const household of households) {
    const scoringResult = calculatePillarScores(household, model)
    const householdSeverity = calculateHouseholdSeverity(
      household,
      scoringResult.scores,
      model
    )
    householdSeverities.push(householdSeverity)
  }

  // Step 2: Group by area (pcode) and calculate area severity
  const areaMap = new Map<string, AreaSeverityResult>()

  // Get unique pcodes
  const uniquePcodes = new Set(householdSeverities.map(h => h.pcode))

  for (const pcode of uniquePcodes) {
    // Find admin boundary info if available
    const boundary = options?.adminBoundaries?.find(b => b.pcode === pcode)
    const areaName = boundary?.name || pcode
    const areaLevel = boundary?.level || 0

    // Get population for this area
    const populationEntry = options?.populationData?.find(p => p.pcode === pcode)
    const totalPopulation = populationEntry?.population || 0

    // If population groups are specified, calculate separately for each
    if (options?.populationGroups && options.populationGroups.length > 0) {
      for (const group of options.populationGroups) {
        const groupPopulation = options.populationData?.find(
          p => p.pcode === pcode && p.population_group === group
        )?.population || 0

        const areaResult = calculateAreaSeverity(
          householdSeverities,
          pcode,
          `${areaName} (${group})`,
          areaLevel,
          groupPopulation,
          group
        )

        if (boundary) {
          areaResult.admin_boundary_id = boundary.id
        }

        const key = `${pcode}_${group || 'all'}`
        areaMap.set(key, areaResult)
      }
    } else {
      // Calculate for all households together
      const areaResult = calculateAreaSeverity(
        householdSeverities,
        pcode,
        areaName,
        areaLevel,
        totalPopulation
      )

      if (boundary) {
        areaResult.admin_boundary_id = boundary.id
      }

      areaMap.set(pcode, areaResult)
    }
  }

  const areaSeverities = Array.from(areaMap.values())

  // Step 3: Calculate summary statistics
  const totalHouseholds = householdSeverities.length
  const totalAreas = areaSeverities.length
  const totalPin = areaSeverities.reduce((sum, area) => sum + area.pin_count, 0)

  const severityBreakdown = {
    phase1: householdSeverities.filter(h => h.finalSeverity === 1).length,
    phase2: householdSeverities.filter(h => h.finalSeverity === 2).length,
    phase3: householdSeverities.filter(h => h.finalSeverity === 3).length,
    phase4: householdSeverities.filter(h => h.finalSeverity === 4).length,
    phase5: householdSeverities.filter(h => h.finalSeverity === 5).length,
  }

  return {
    householdSeverities,
    areaSeverities,
    summary: {
      total_households: totalHouseholds,
      total_areas: totalAreas,
      total_pin: totalPin,
      severity_breakdown: severityBreakdown,
    },
  }
}

