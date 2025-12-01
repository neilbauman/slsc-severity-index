import { inferPcodePattern } from '@/lib/config/country-config'

/**
 * Infer Pcode patterns for all admin levels from uploaded boundaries
 */
export function inferPcodePatternsFromBoundaries(boundariesByLevel: Map<number, Array<{ pcode: string | null }>>): Map<number, string> {
  const patterns = new Map<number, string>()
  
  for (const [level, boundaries] of boundariesByLevel.entries()) {
    const pcodes = boundaries
      .map(b => b.pcode)
      .filter((p): p is string => p !== null && p !== undefined)
    
    if (pcodes.length > 0) {
      const pattern = inferPcodePattern(pcodes)
      if (pattern) {
        patterns.set(level, pattern)
      }
    }
  }
  
  return patterns
}

