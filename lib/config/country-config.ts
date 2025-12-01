import { z } from 'zod'

export const AdminLevelSchema = z.object({
  level: z.number().int().min(0),
  name: z.string().min(1),
  pcodePattern: z.string().optional(), // Regex pattern - inferred after GIS upload
})

export const CountryConfigSchema = z.object({
  countryCode: z.string().length(3),
  adminLevels: z.array(AdminLevelSchema),
  datasetTypes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    schemaDefinition: z.record(z.string(), z.any()).optional(),
    badgeColor: z.string().optional(),
  })).optional(),
  calculationModel: z.string().optional(),
})

export type AdminLevel = z.infer<typeof AdminLevelSchema>
export type CountryConfig = z.infer<typeof CountryConfigSchema>

// Example Philippines configuration
// Adm0 = Country, Adm1 = Region, Adm2 = Province, Adm3 = City/Municipality, Adm4 = Barangay
// Note: Pcode patterns will be automatically inferred after GIS data is uploaded
export const PHILIPPINES_CONFIG: CountryConfig = {
  countryCode: 'PHL',
  adminLevels: [
    { level: 0, name: 'Country' },
    { level: 1, name: 'Region' },
    { level: 2, name: 'Province' },
    { level: 3, name: 'City/Municipality' },
    { level: 4, name: 'Barangay' },
  ],
  calculationModel: 'philippines-ssc-v1',
}

export function validatePcode(pcode: string, pattern?: string): boolean {
  if (!pattern) return true // No validation if pattern not set
  try {
    const regex = new RegExp(pattern)
    return regex.test(pcode)
  } catch {
    return false
  }
}

/**
 * Infer Pcode pattern from a set of Pcode values
 * Analyzes the structure and generates a regex pattern
 */
export function inferPcodePattern(pcodes: string[]): string {
  if (pcodes.length === 0) return ''
  
  // Filter out null/empty values
  const validPcodes = pcodes.filter(p => p && typeof p === 'string')
  if (validPcodes.length === 0) return ''
  
  // Check if all are the same (exact match)
  const uniquePcodes = new Set(validPcodes)
  if (uniquePcodes.size === 1) {
    return `^${validPcodes[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
  }
  
  // Check if all have the same length
  const lengths = new Set(validPcodes.map(p => p.length))
  if (lengths.size === 1) {
    const length = Array.from(lengths)[0]
    // Check if all are numeric
    if (validPcodes.every(p => /^[0-9]+$/.test(p))) {
      return `^[0-9]{${length}}$`
    }
    // Check if all are alphanumeric
    if (validPcodes.every(p => /^[A-Z0-9]+$/i.test(p))) {
      return `^[A-Z0-9]{${length}}$`
    }
  }
  
  // Analyze common patterns
  const minLength = Math.min(...validPcodes.map(p => p.length))
  const maxLength = Math.max(...validPcodes.map(p => p.length))
  
  // Hierarchical pattern (e.g., 01, 0101, 010101)
  if (maxLength > minLength && validPcodes.every(p => /^[0-9]+$/.test(p))) {
    // Check if longer codes start with shorter ones
    const sorted = [...validPcodes].sort((a, b) => a.length - b.length)
    if (sorted.length > 1) {
      // Return flexible pattern for hierarchical codes
      return `^[0-9]{${minLength},${maxLength}}$`
    }
  }
  
  // Default: match exact structure of first valid code
  const first = validPcodes[0]
  return `^${first.replace(/[0-9]/g, '\\d').replace(/[A-Z]/gi, '[A-Z0-9]')}$`
}

