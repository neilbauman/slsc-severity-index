/**
 * Data Quality Analysis for Admin Boundaries
 * Analyzes uploaded data and provides cleaning recommendations
 */

export interface QualityIssue {
  severity: 'error' | 'warning' | 'info'
  type: string
  message: string
  affectedCount: number
  affectedItems: Array<{
    id?: string
    name: string
    level: number
    pcode?: string | null
    details?: Record<string, any>
  }>
  recommendation: string
  autoFixable?: boolean
}

export interface QualityReport {
  overallScore: number // 0-100
  totalBoundaries: number
  issues: QualityIssue[]
  summary: {
    byLevel: Record<number, {
      count: number
      withPcode: number
      withParent: number
      issues: number
    }>
    completeness: {
      hasPcode: number
      hasParent: number
      hasGeometry: number
    }
  }
  recommendations: string[]
}

/**
 * Analyze admin boundaries data quality
 */
export async function analyzeAdminBoundariesQuality(
  supabase: any,
  countryId: string
): Promise<QualityReport> {
  const issues: QualityIssue[] = []
  const recommendations: string[] = []

  // Fetch all boundaries for this country
  const { data: boundaries, error } = await supabase
    .from('admin_boundaries')
    .select('id, level, name, pcode, parent_id, geometry')
    .eq('country_id', countryId)
    .order('level', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch boundaries: ${error.message}`)
  }

  if (!boundaries || boundaries.length === 0) {
    return {
      overallScore: 0,
      totalBoundaries: 0,
      issues: [],
      summary: {
        byLevel: {},
        completeness: {
          hasPcode: 0,
          hasParent: 0,
          hasGeometry: 0,
        },
      },
      recommendations: ['No boundaries found to analyze'],
    }
  }

  const totalBoundaries = boundaries.length

  // Group by level
  const byLevel = new Map<number, typeof boundaries>()
  boundaries.forEach((b: any) => {
    if (!byLevel.has(b.level)) {
      byLevel.set(b.level, [])
    }
    byLevel.get(b.level)!.push(b)
  })

  // Build parent-child map
  const idToBoundary = new Map(boundaries.map((b: any) => [b.id, b]))
  const childrenByParent = new Map<string, typeof boundaries>()
  boundaries.forEach((b: any) => {
    if (b.parent_id) {
      if (!childrenByParent.has(b.parent_id)) {
        childrenByParent.set(b.parent_id, [])
      }
      childrenByParent.get(b.parent_id)!.push(b)
    }
  })

  // 1. Check for missing pcodes
  const missingPcodes = boundaries.filter((b: any) => !b.pcode)
  if (missingPcodes.length > 0) {
    issues.push({
      severity: 'warning',
      type: 'missing_pcode',
      message: `${missingPcodes.length} boundaries are missing pcodes`,
      affectedCount: missingPcodes.length,
      affectedItems: missingPcodes.slice(0, 20).map((b: any) => ({
        id: b.id,
        name: b.name,
        level: b.level,
        pcode: b.pcode,
      })),
      recommendation: 'Add pcodes to boundaries for better data integrity and hierarchical relationships. Pcodes should follow a consistent pattern (e.g., MZ, MZ01, MZ0101).',
      autoFixable: false,
    })
    recommendations.push(`Add pcodes to ${missingPcodes.length} boundaries`)
  }

  // 2. Check for orphaned boundaries (level > 0 but no parent)
  const orphanedBoundaries = boundaries.filter(
    (b: any) => b.level > 0 && !b.parent_id
  )
  if (orphanedBoundaries.length > 0) {
    issues.push({
      severity: 'warning',
      type: 'orphaned_boundary',
      message: `${orphanedBoundaries.length} boundaries (level > 0) are missing parent relationships`,
      affectedCount: orphanedBoundaries.length,
      affectedItems: orphanedBoundaries.slice(0, 20).map((b: any) => ({
        id: b.id,
        name: b.name,
        level: b.level,
        pcode: b.pcode,
        details: {
          expectedParentLevel: b.level - 1,
        },
      })),
      recommendation: 'Review parent relationships. Boundaries at level > 0 should typically have a parent. Check if parent boundaries exist and if parent pcode/name fields were correctly detected during upload.',
      autoFixable: false,
    })
    recommendations.push(`Fix parent relationships for ${orphanedBoundaries.length} orphaned boundaries`)
  }

  // 3. Check for duplicate names at same level
  const duplicateNames = new Map<string, typeof boundaries>()
  boundaries.forEach((b: any) => {
    const key = `${b.level}:${b.name}`
    if (!duplicateNames.has(key)) {
      duplicateNames.set(key, [])
    }
    duplicateNames.get(key)!.push(b)
  })

  const duplicates = Array.from(duplicateNames.values()).filter(
    (group) => group.length > 1
  )
  if (duplicates.length > 0) {
    const duplicateItems = duplicates.flat()
    issues.push({
      severity: 'error',
      type: 'duplicate_name',
      message: `Found ${duplicates.length} groups of boundaries with duplicate names at the same level`,
      affectedCount: duplicateItems.length,
      affectedItems: duplicateItems.slice(0, 20).map((b: any) => ({
        id: b.id,
        name: b.name,
        level: b.level,
        pcode: b.pcode,
        details: {
          duplicateCount: duplicates.find((d) => d.includes(b))?.length || 0,
        },
      })),
      recommendation: 'Review duplicate boundaries. They may be actual duplicates that should be merged, or they may represent different entities that need distinct names or pcodes.',
      autoFixable: true,
    })
    recommendations.push(`Review and merge ${duplicates.length} groups of duplicate boundaries`)
  }

  // 4. Check for duplicate pcodes
  const pcodeMap = new Map<string, typeof boundaries>()
  boundaries.forEach((b: any) => {
    if (b.pcode) {
      if (!pcodeMap.has(b.pcode)) {
        pcodeMap.set(b.pcode, [])
      }
      pcodeMap.get(b.pcode)!.push(b)
    }
  })

  const duplicatePcodes = Array.from(pcodeMap.values()).filter(
    (group) => group.length > 1
  )
  if (duplicatePcodes.length > 0) {
    const duplicateItems = duplicatePcodes.flat()
    issues.push({
      severity: 'error',
      type: 'duplicate_pcode',
      message: `Found ${duplicatePcodes.length} groups of boundaries with duplicate pcodes`,
      affectedCount: duplicateItems.length,
      affectedItems: duplicateItems.slice(0, 20).map((b: any) => ({
        id: b.id,
        name: b.name,
        level: b.level,
        pcode: b.pcode,
        details: {
          duplicateCount: duplicatePcodes.find((d) => d.includes(b))?.length || 0,
        },
      })),
      recommendation: 'Pcodes should be unique. Review boundaries with duplicate pcodes - they may need correction or merging.',
      autoFixable: false,
    })
    recommendations.push(`Fix ${duplicatePcodes.length} groups of boundaries with duplicate pcodes`)
  }

  // 5. Check for boundaries with same name but different pcodes
  const nameGroups = new Map<string, typeof boundaries>()
  boundaries.forEach((b: any) => {
    if (!nameGroups.has(b.name)) {
      nameGroups.set(b.name, [])
    }
    nameGroups.get(b.name)!.push(b)
  })

  const namePcodeMismatches = Array.from(nameGroups.values())
    .filter((group) => {
      const uniquePcodes = new Set(group.map((b: any) => b.pcode).filter(Boolean))
      return uniquePcodes.size > 1
    })
    .flat()

  if (namePcodeMismatches.length > 0) {
    issues.push({
      severity: 'warning',
      type: 'name_pcode_mismatch',
      message: `Found boundaries with same name but different pcodes`,
      affectedCount: namePcodeMismatches.length,
      affectedItems: namePcodeMismatches.slice(0, 20).map((b: any) => ({
        id: b.id,
        name: b.name,
        level: b.level,
        pcode: b.pcode,
      })),
      recommendation: 'Review boundaries with same name but different pcodes. They may represent different entities that need distinct names, or the same entity with incorrect pcodes.',
      autoFixable: false,
    })
    recommendations.push(`Review ${namePcodeMismatches.length} boundaries with name/pcode mismatches`)
  }

  // 6. Check for missing geometries
  const missingGeometries = boundaries.filter((b: any) => !b.geometry)
  if (missingGeometries.length > 0) {
    issues.push({
      severity: 'error',
      type: 'missing_geometry',
      message: `${missingGeometries.length} boundaries are missing geometry data`,
      affectedCount: missingGeometries.length,
      affectedItems: missingGeometries.slice(0, 20).map((b: any) => ({
        id: b.id,
        name: b.name,
        level: b.level,
        pcode: b.pcode,
      })),
      recommendation: 'All boundaries must have geometry data. Re-upload the boundaries with valid geometry.',
      autoFixable: false,
    })
    recommendations.push(`Fix ${missingGeometries.length} boundaries missing geometry`)
  }

  // 7. Check for invalid parent relationships (parent at same or higher level)
  const invalidParents = boundaries.filter((b: any) => {
    if (!b.parent_id) return false
    const parent = idToBoundary.get(b.parent_id)
    if (!parent) return false
    return parent.level >= b.level
  })

  if (invalidParents.length > 0) {
    issues.push({
      severity: 'error',
      type: 'invalid_parent_level',
      message: `${invalidParents.length} boundaries have invalid parent relationships (parent at same or higher level)`,
      affectedCount: invalidParents.length,
      affectedItems: invalidParents.slice(0, 20).map((b: any) => {
        const parent = idToBoundary.get(b.parent_id!)
        return {
          id: b.id,
          name: b.name,
          level: b.level,
          pcode: b.pcode,
          details: {
            parentName: parent?.name,
            parentLevel: parent?.level,
          },
        }
      }),
      recommendation: 'Parent boundaries must be at a lower level number (e.g., level 1 parent for level 2 child). Fix invalid parent relationships.',
      autoFixable: false,
    })
    recommendations.push(`Fix ${invalidParents.length} boundaries with invalid parent levels`)
  }

  // 8. Check for pcode pattern consistency
  const pcodePatterns = new Map<number, Set<string>>()
  boundaries.forEach((b: any) => {
    if (b.pcode) {
      // Extract pattern (e.g., "MZ##" or "MZ####")
      const pattern = b.pcode.replace(/\d/g, '#')
      if (!pcodePatterns.has(b.level)) {
        pcodePatterns.set(b.level, new Set())
      }
      pcodePatterns.get(b.level)!.add(pattern)
    }
  })

  const inconsistentPatterns: typeof boundaries = []
  boundaries.forEach((b: any) => {
    if (b.pcode) {
      const pattern = b.pcode.replace(/\d/g, '#')
      const levelPatterns = pcodePatterns.get(b.level)
      if (levelPatterns && levelPatterns.size > 1) {
        inconsistentPatterns.push(b)
      }
    }
  })

  if (inconsistentPatterns.length > 0) {
    const uniqueInconsistent = Array.from(
      new Map(inconsistentPatterns.map((b: any) => [b.id, b])).values()
    )
    issues.push({
      severity: 'warning',
      type: 'inconsistent_pcode_pattern',
      message: `Found inconsistent pcode patterns within admin levels`,
      affectedCount: uniqueInconsistent.length,
      affectedItems: uniqueInconsistent.slice(0, 20).map((b: any) => ({
        id: b.id,
        name: b.name,
        level: b.level,
        pcode: b.pcode,
        details: {
          pattern: b.pcode?.replace(/\d/g, '#'),
        },
      })),
      recommendation: 'Pcodes should follow a consistent pattern within each admin level. Review and standardize pcode formats.',
      autoFixable: false,
    })
    recommendations.push(`Standardize pcode patterns for ${uniqueInconsistent.length} boundaries`)
  }

  // Calculate summary statistics
  const summary = {
    byLevel: {} as Record<number, {
      count: number
      withPcode: number
      withParent: number
      issues: number
    }>,
    completeness: {
      hasPcode: boundaries.filter((b: any) => b.pcode).length,
      hasParent: boundaries.filter((b: any) => b.parent_id).length,
      hasGeometry: boundaries.filter((b: any) => b.geometry).length,
    },
  }

  byLevel.forEach((levelBoundaries, level) => {
    summary.byLevel[level] = {
      count: levelBoundaries.length,
      withPcode: levelBoundaries.filter((b: any) => b.pcode).length,
      withParent: levelBoundaries.filter((b: any) => b.parent_id).length,
      issues: issues.filter((issue) =>
        issue.affectedItems.some((item) => item.level === level)
      ).length,
    }
  })

  // Calculate overall score (0-100)
  let score = 100
  const errorPenalty = 10
  const warningPenalty = 5
  const infoPenalty = 1

  issues.forEach((issue) => {
    if (issue.severity === 'error') {
      score -= errorPenalty * Math.min(issue.affectedCount / totalBoundaries, 0.5)
    } else if (issue.severity === 'warning') {
      score -= warningPenalty * Math.min(issue.affectedCount / totalBoundaries, 0.3)
    } else {
      score -= infoPenalty * Math.min(issue.affectedCount / totalBoundaries, 0.1)
    }
  })

  score = Math.max(0, Math.min(100, score))

  return {
    overallScore: Math.round(score),
    totalBoundaries,
    issues,
    summary,
    recommendations: recommendations.length > 0 ? recommendations : ['Data quality looks good!'],
  }
}

