import { z } from 'zod'

export const AdminLevelSchema = z.object({
  level: z.number().int().min(0),
  name: z.string().min(1),
  pcodePattern: z.string(), // Regex pattern as string
})

export const CountryConfigSchema = z.object({
  countryCode: z.string().length(3),
  adminLevels: z.array(AdminLevelSchema),
  datasetTypes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    schemaDefinition: z.record(z.any()).optional(),
    badgeColor: z.string().optional(),
  })).optional(),
  calculationModel: z.string().optional(),
})

export type AdminLevel = z.infer<typeof AdminLevelSchema>
export type CountryConfig = z.infer<typeof CountryConfigSchema>

// Example Philippines configuration
export const PHILIPPINES_CONFIG: CountryConfig = {
  countryCode: 'PHL',
  adminLevels: [
    { level: 0, name: 'Region', pcodePattern: '^[0-9]{2}$' },
    { level: 1, name: 'Province', pcodePattern: '^[0-9]{2}[0-9]{2}$' },
    { level: 2, name: 'City/Municipality', pcodePattern: '^[0-9]{4}[0-9]{3}$' },
    { level: 3, name: 'Barangay', pcodePattern: '^[0-9]{7}[0-9]{3}$' },
  ],
  calculationModel: 'philippines-ssc-v1',
}

export function validatePcode(pcode: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern)
    return regex.test(pcode)
  } catch {
    return false
  }
}

