/**
 * Data Quality Analysis for Datasets
 * Analyzes uploaded datasets and provides cleaning recommendations
 */

export interface DatasetQualityIssue {
  severity: 'error' | 'warning' | 'info'
  type: string
  message: string
  affectedCount: number
  affectedRows?: Array<{
    rowIndex?: number
    pcode?: string
    name?: string
    details?: Record<string, any>
  }>
  recommendation: string
  autoFixable?: boolean
}

export interface DatasetQualityReport {
  overallScore: number // 0-100
  totalRows: number
  issues: DatasetQualityIssue[]
  summary: {
    completeness: {
      hasPcode: number
      hasName: number
      hasPopulation: number
      hasGeometry: number
    }
    duplicates: {
      duplicatePcodes: number
      duplicateNames: number
    }
    validation: {
      invalidPcodes: number
      missingMatches: number
      negativeValues: number
    }
  }
  recommendations: string[]
}

/**
 * Analyze dataset data quality
 * This is a generic analyzer that works with any dataset structure
 */
export async function analyzeDatasetQuality(
  supabase: any,
  datasetId: string,
  datasetData?: any[] // Optional: pre-fetched data
): Promise<DatasetQualityReport> {
  const issues: DatasetQualityIssue[] = []
  const recommendations: string[] = []

  // Fetch dataset metadata
  const { data: dataset, error: datasetError } = await supabase
    .from('datasets')
    .select('*')
    .eq('id', datasetId)
    .single()

  if (datasetError || !dataset) {
    throw new Error(`Failed to fetch dataset: ${datasetError?.message || 'Dataset not found'}`)
  }

  // If data not provided, try to fetch from file
  let data: any[] = datasetData || []
  
  if (data.length === 0 && dataset.file_path) {
    // Try to read from storage
    const { data: fileData, error: fileError } = await supabase.storage
      .from('datasets')
      .download(dataset.file_path)

    if (!fileError && fileData) {
      // Parse file based on extension
      const text = await fileData.text()
      if (dataset.file_path.endsWith('.json') || dataset.file_path.endsWith('.geojson')) {
        const json = JSON.parse(text)
        if (json.features) {
          data = json.features.map((f: any) => ({ ...f.properties, _geometry: f.geometry }))
        } else if (Array.isArray(json)) {
          data = json
        }
      } else if (dataset.file_path.endsWith('.csv')) {
        // Use papaparse for proper CSV parsing (handles quoted fields, commas in quotes, etc.)
        const Papa = (await import('papaparse')).default
        const parseResult = Papa.parse<Record<string, any>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header: string) => header.trim(),
          transform: (value: string) => value.trim() || null,
        })

        if (parseResult.errors && parseResult.errors.length > 0) {
          console.warn('CSV parsing warnings:', parseResult.errors)
        }

        data = parseResult.data
      } else if (dataset.file_path.endsWith('.xlsx') || dataset.file_path.endsWith('.xls')) {
        // Excel file processing
        const { processExcelFile } = await import('./excel-processor')
        const fileBuffer = await fileData.arrayBuffer()
        const excelResult = await processExcelFile(fileBuffer)
        data = excelResult.rows
      }
    }
  }

  if (data.length === 0) {
    return {
      overallScore: 0,
      totalRows: 0,
      issues: [{
        severity: 'error',
        type: 'no_data',
        message: 'No data found in dataset',
        affectedCount: 0,
        recommendation: 'Upload a valid dataset file with data rows.',
        autoFixable: false,
      }],
      summary: {
        completeness: {
          hasPcode: 0,
          hasName: 0,
          hasPopulation: 0,
          hasGeometry: 0,
        },
        duplicates: {
          duplicatePcodes: 0,
          duplicateNames: 0,
        },
        validation: {
          invalidPcodes: 0,
          missingMatches: 0,
          negativeValues: 0,
        },
      },
      recommendations: ['Upload dataset data'],
    }
  }

  const totalRows = data.length

  // Detect common field names
  const detectField = (patterns: string[], data: any[]): string | null => {
    for (const pattern of patterns) {
      const field = Object.keys(data[0] || {}).find(
        (k) => k.toLowerCase().includes(pattern.toLowerCase())
      )
      if (field) return field
    }
    return null
  }

  const pcodeField = detectField(['pcode', 'adm', 'code'], data)
  const nameField = detectField(['name', 'admin', 'area'], data)
  const populationField = detectField(['pop', 'population', 'total'], data)
  const geometryField = detectField(['geometry', 'geom', 'shape'], data) || '_geometry'

  // 1. Check for missing pcodes
  if (pcodeField) {
    const missingPcodes = data.filter((row) => !row[pcodeField] || row[pcodeField] === '')
    if (missingPcodes.length > 0) {
      issues.push({
        severity: 'warning',
        type: 'missing_pcode',
        message: `${missingPcodes.length} rows are missing pcodes`,
        affectedCount: missingPcodes.length,
        affectedRows: missingPcodes.slice(0, 20).map((row, idx) => ({
          rowIndex: idx,
          pcode: row[pcodeField],
          name: nameField ? row[nameField] : undefined,
        })),
        recommendation: 'Add pcodes to rows for better data matching with administrative boundaries.',
        autoFixable: false,
      })
      recommendations.push(`Add pcodes to ${missingPcodes.length} rows`)
    }
  }

  // 2. Check for duplicate pcodes
  if (pcodeField) {
    const pcodeMap = new Map<string, number[]>()
    data.forEach((row, idx) => {
      if (row[pcodeField]) {
        if (!pcodeMap.has(row[pcodeField])) {
          pcodeMap.set(row[pcodeField], [])
        }
        pcodeMap.get(row[pcodeField])!.push(idx)
      }
    })

    const duplicatePcodes = Array.from(pcodeMap.entries())
      .filter(([_, indices]) => indices.length > 1)
      .flatMap(([pcode, indices]) => indices.map((idx) => ({ pcode, rowIndex: idx })))

    if (duplicatePcodes.length > 0) {
      issues.push({
        severity: 'error',
        type: 'duplicate_pcode',
        message: `Found ${duplicatePcodes.length} rows with duplicate pcodes`,
        affectedCount: duplicatePcodes.length,
        affectedRows: duplicatePcodes.slice(0, 20).map(({ pcode, rowIndex }) => ({
          rowIndex,
          pcode,
          name: nameField ? data[rowIndex]?.[nameField] : undefined,
        })),
        recommendation: 'Pcodes should be unique. Review and fix duplicate pcodes.',
        autoFixable: true,
      })
      recommendations.push(`Fix ${duplicatePcodes.length} duplicate pcodes`)
    }
  }

  // 3. Check for missing population values
  if (populationField) {
    const missingPopulation = data.filter(
      (row) => !row[populationField] || row[populationField] === '' || isNaN(Number(row[populationField]))
    )
    if (missingPopulation.length > 0) {
      issues.push({
        severity: 'warning',
        type: 'missing_population',
        message: `${missingPopulation.length} rows are missing valid population values`,
        affectedCount: missingPopulation.length,
        affectedRows: missingPopulation.slice(0, 20).map((row, idx) => ({
          rowIndex: idx,
          pcode: pcodeField ? row[pcodeField] : undefined,
          name: nameField ? row[nameField] : undefined,
        })),
        recommendation: 'Add population values to rows for accurate calculations.',
        autoFixable: false,
      })
      recommendations.push(`Add population values to ${missingPopulation.length} rows`)
    }
  }

  // 4. Check for negative values
  if (populationField) {
    const negativeValues = data.filter(
      (row) => row[populationField] && Number(row[populationField]) < 0
    )
    if (negativeValues.length > 0) {
      issues.push({
        severity: 'error',
        type: 'negative_values',
        message: `${negativeValues.length} rows have negative population values`,
        affectedCount: negativeValues.length,
        affectedRows: negativeValues.slice(0, 20).map((row, idx) => ({
          rowIndex: idx,
          pcode: pcodeField ? row[pcodeField] : undefined,
          name: nameField ? row[nameField] : undefined,
          details: { value: row[populationField] },
        })),
        recommendation: 'Population values should not be negative. Review and fix these values.',
        autoFixable: true,
      })
      recommendations.push(`Fix ${negativeValues.length} negative values`)
    }
  }

  // 5. Check for unmatched pcodes (if admin boundaries exist)
  if (pcodeField) {
    const { data: country } = await supabase
      .from('countries')
      .select('id')
      .eq('id', dataset.country_id)
      .single()

    if (country) {
      const { data: boundaries } = await supabase
        .from('admin_boundaries')
        .select('pcode')
        .eq('country_id', country.id)
        .not('pcode', 'is', null)

      if (boundaries && boundaries.length > 0) {
        const validPcodes = new Set(boundaries.map((b: any) => b.pcode))
        const unmatchedPcodes = data.filter(
          (row) => row[pcodeField] && !validPcodes.has(row[pcodeField])
        )

        if (unmatchedPcodes.length > 0) {
          issues.push({
            severity: 'warning',
            type: 'unmatched_pcode',
            message: `${unmatchedPcodes.length} rows have pcodes that don't match any administrative boundaries`,
            affectedCount: unmatchedPcodes.length,
            affectedRows: unmatchedPcodes.slice(0, 20).map((row, idx) => ({
              rowIndex: idx,
              pcode: row[pcodeField],
              name: nameField ? row[nameField] : undefined,
            })),
            recommendation: "Review pcodes that don't match administrative boundaries. They may need correction or the boundaries may need to be updated.",
            autoFixable: false,
          })
          recommendations.push(`Review ${unmatchedPcodes.length} unmatched pcodes`)
        }
      }
    }
  }

  // Calculate summary statistics
  const summary = {
    completeness: {
      hasPcode: pcodeField ? data.filter((r) => r[pcodeField]).length : 0,
      hasName: nameField ? data.filter((r) => r[nameField]).length : 0,
      hasPopulation: populationField ? data.filter((r) => r[populationField] && !isNaN(Number(r[populationField]))).length : 0,
      hasGeometry: data.filter((r) => r[geometryField]).length,
    },
    duplicates: {
      duplicatePcodes: pcodeField ? Array.from(new Map(data.map((r, i) => [r[pcodeField], i])).values()).length : 0,
      duplicateNames: nameField ? Array.from(new Map(data.map((r, i) => [r[nameField], i])).values()).length : 0,
    },
    validation: {
      invalidPcodes: 0, // Could add pattern validation
      missingMatches: 0, // Calculated above
      negativeValues: populationField ? data.filter((r) => r[populationField] && Number(r[populationField]) < 0).length : 0,
    },
  }

  // Calculate overall score
  let score = 100
  const errorPenalty = 10
  const warningPenalty = 5

  issues.forEach((issue) => {
    if (issue.severity === 'error') {
      score -= errorPenalty * Math.min(issue.affectedCount / totalRows, 0.5)
    } else if (issue.severity === 'warning') {
      score -= warningPenalty * Math.min(issue.affectedCount / totalRows, 0.3)
    }
  })

  score = Math.max(0, Math.min(100, score))

  return {
    overallScore: Math.round(score),
    totalRows,
    issues,
    summary,
    recommendations: recommendations.length > 0 ? recommendations : ['Data quality looks good!'],
  }
}

