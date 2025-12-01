import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import simplify from '@turf/simplify'
import { featureCollection } from '@turf/helpers'
import * as shp from 'shapefile'
import JSZip from 'jszip'
import { inferPcodePatternsFromBoundaries } from '@/lib/processing/pcode-inference'
import { validatePcode } from '@/lib/config/country-config'

// Increase body size limit for large file uploads (50MB)
export const maxDuration = 300 // 5 minutes for processing large files
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Create service role client for inserts (bypasses RLS)
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js')
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set!')
      return NextResponse.json(
        { error: 'Server configuration error: Service role key not configured' },
        { status: 500 }
      )
    }
    
    const serviceRoleSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const formData = await request.formData()
    const countryId = formData.get('countryId') as string
    const processAllLevels = formData.get('processAllLevels') === 'true'
    const autoDetect = formData.get('autoDetect') === 'true'
    const simplifyTolerance = parseFloat(formData.get('simplifyTolerance') as string) || 0.0001
    const hdxUrl = formData.get('hdxUrl') as string | null
    const filePath = formData.get('filePath') as string | null
    // Legacy support: also check for direct file upload (for smaller files)
    const file = formData.get('file') as File | null

    let geojson: any

    // Fetch or process file
    if (hdxUrl) {
      // Fetch from HDX - this is a simplified version
      // HDX API would need to be implemented properly
      // For now, we'll expect a direct GeoJSON URL or handle the HDX dataset page
      geojson = await fetchFromHDX(hdxUrl)
    } else if (filePath) {
      // Download file from Supabase Storage
      geojson = await processFileFromStorage(supabase, filePath)
    } else if (file) {
      // Legacy: direct file upload (for smaller files)
      geojson = await processFile(file)
    } else {
      return NextResponse.json({ error: 'No data source provided' }, { status: 400 })
    }

    if (!geojson || !geojson.features) {
      return NextResponse.json({ error: 'Invalid GeoJSON data' }, { status: 400 })
    }

    // Simplify geometries
    const simplified = simplify(geojson, { tolerance: simplifyTolerance, highQuality: true })

    // Log geometry types immediately to diagnose issues and store for later use
    const geometryTypeCounts = new Map<string, number>()
    for (const feature of simplified.features) {
      const geomType = feature.geometry?.type || 'null'
      geometryTypeCounts.set(geomType, (geometryTypeCounts.get(geomType) || 0) + 1)
    }
    console.log('=== GEOMETRY TYPES IN FILE ===')
    console.log('Geometry type distribution:', Object.fromEntries(geometryTypeCounts.entries()))
    console.log('Total features:', simplified.features.length)
    if (simplified.features.length > 0) {
      const firstFeat = simplified.features[0]
      console.log('First feature geometry:', {
        type: firstFeat.geometry?.type || 'null',
        hasGeometry: !!firstFeat.geometry,
        geometryKeys: firstFeat.geometry ? Object.keys(firstFeat.geometry) : []
      })
    }
    console.log('=============================')
    
    // Store geometry types for use in error messages (make it accessible in the scope)
    const fileGeometryTypes = Object.fromEntries(geometryTypeCounts.entries())

    // Detect available admin levels from the first feature
    const firstFeature = simplified.features[0]
    const properties = firstFeature?.properties || {}
    
    // Log available properties for debugging (this will show in Vercel logs)
    const propertyKeys = Object.keys(properties)
    console.log('=== FILE PROPERTIES DEBUG ===')
    console.log('Total properties:', propertyKeys.length)
    console.log('All properties:', JSON.stringify(propertyKeys, null, 2))
    console.log('Sample feature properties (first 20):', JSON.stringify(
      Object.fromEntries(Object.entries(properties).slice(0, 20)), 
      null, 
      2
    ))
    // Check specific Mozambique fields
    console.log('Mozambique field values:', {
      name: properties.name,
      name1: properties.name1,
      name2: properties.name2,
      name3: properties.name3,
      adm4_name: properties.adm4_name,
    })
    console.log('============================')
    
    // Find all ADM level fields with flexible naming patterns
    const detectedLevels = new Map<number, { nameField: string; pcodeField: string }>()
    
    if (autoDetect && processAllLevels) {
      // Try multiple naming patterns for each admin level
      for (let level = 0; level <= 6; level++) {
        // Try various field name patterns
        // Check Mozambique patterns first (more specific)
        const namePatterns = [
          // Mozambique COD pattern: adm0_name, adm1_name, adm2_name, adm3_name (check these first)
          `adm${level}_name`,    // Primary: adm0_name, adm1_name, adm2_name, adm3_name
          `ADM${level}_NAME`,    // Uppercase variant
          `Adm${level}_Name`,    // Mixed case variant
          // Mozambique alternative pattern: name, name1, name2, name3
          level === 0 ? 'name' : null,
          level === 1 ? 'name1' : null,
          level === 2 ? 'name2' : null,
          level === 3 ? 'name3' : null,
          // ADM4 pattern: adm4_name (primary), adm4_name1, adm4_name2 (alternatives)
          level === 4 ? 'adm4_name' : null,
          level === 4 ? 'adm4_name1' : null,
          level === 4 ? 'adm4_name2' : null,
          // Standard patterns
          `ADM${level}_EN`,      // Standard: ADM0_EN, ADM1_EN
          `ADM${level}`,         // Without suffix: ADM0, ADM1
          `NAME_${level}`,       // Alternative: NAME_0, NAME_1
          `ADMIN${level}`,       // Alternative: ADMIN0, ADMIN1
          `ADM${level}_PT`,      // Portuguese: ADM0_PT, ADM1_PT
          `ADM${level}_FR`,      // French: ADM0_FR, ADM1_FR
          `adm${level}_en`,      // Lowercase: adm0_en, adm1_en
          `Adm${level}_En`,      // Mixed case: Adm0_En, Adm1_En
        ].filter(Boolean) as string[]
        
        const pcodePatterns = [
          `ADM${level}_PCODE`,   // Standard: ADM0_PCODE, ADM1_PCODE
          `ADM${level}_Pcode`,   // Mixed case
          `adm${level}_pcode`,   // Lowercase with underscore (Mozambique format)
          `adm${level}_Pcode`,   // Mixed case with underscore
          `PCODE${level}`,       // Alternative: PCODE0, PCODE1
          `pcode${level}`,       // Lowercase
          `pcode_${level}`,      // Lowercase with underscore
          `ADM${level}_CODE`,    // Alternative: ADM0_CODE
          `adm${level}_code`,    // Lowercase alternative
          // Mozambique might not have pcode fields, so we'll make it optional
        ]
        
        // Find matching name field
        // Check multiple features to ensure the field actually has data
        let nameField: string | null = null
        for (const pattern of namePatterns.filter(p => p !== null)) {
          // Check if ANY feature has this field with non-empty data
          let foundWithData = 0
          let firstNonEmptyValue: any = null
          
          for (let i = 0; i < Math.min(20, simplified.features.length); i++) {
            const testValue = simplified.features[i]?.properties?.[pattern]
            if (testValue !== undefined && testValue !== null && String(testValue).trim() !== '') {
              foundWithData++
              if (!firstNonEmptyValue) {
                firstNonEmptyValue = testValue
              }
              if (foundWithData >= 3) break // Found at least 3 features with data
            }
          }
          
          // Require at least 2 features with data to avoid false positives
          // (unless there's only 1 feature total, which is rare)
          if (foundWithData >= 2 || (foundWithData >= 1 && simplified.features.length === 1)) {
            nameField = pattern
            console.log(`Detected level ${level} name field: ${pattern} = "${firstNonEmptyValue}" (found in ${foundWithData} of ${Math.min(20, simplified.features.length)} checked features)`)
            break
          } else if (foundWithData === 1) {
            console.log(`Skipping pattern ${pattern} for level ${level}: only found in 1 feature, need at least 2`)
          }
        }
        
        // Find matching pcode field (optional) - check multiple features like name field
        let pcodeField: string | null = null
        for (const pattern of pcodePatterns) {
          // Check if ANY feature has this field with non-empty data
          let foundWithData = 0
          let firstNonEmptyValue: any = null
          
          for (let i = 0; i < Math.min(20, simplified.features.length); i++) {
            const testValue = simplified.features[i]?.properties?.[pattern]
            if (testValue !== undefined && testValue !== null && String(testValue).trim() !== '') {
              foundWithData++
              if (!firstNonEmptyValue) {
                firstNonEmptyValue = testValue
              }
              if (foundWithData >= 3) break // Found at least 3 features with data
            }
          }
          
          // Require at least 2 features with data to avoid false positives
          if (foundWithData >= 2 || (foundWithData >= 1 && simplified.features.length === 1)) {
            pcodeField = pattern
            console.log(`Detected level ${level} pcode field: ${pattern} = "${firstNonEmptyValue}" (found in ${foundWithData} of ${Math.min(20, simplified.features.length)} checked features)`)
            break
          }
        }
        
        // For Mozambique pattern, also check for additional pcode variants if not found yet
        if (nameField && !pcodeField) {
          // Try additional patterns that might match Mozambique format
          const mozPcodePatterns = [
            `adm${level}_pcode`,  // Most common Mozambique format
            `code${level}`,
            `code_${level}`,
          ]
          for (const pattern of mozPcodePatterns) {
            let foundWithData = 0
            for (let i = 0; i < Math.min(20, simplified.features.length); i++) {
              const testValue = simplified.features[i]?.properties?.[pattern]
              if (testValue !== undefined && testValue !== null && String(testValue).trim() !== '') {
                foundWithData++
                if (foundWithData >= 2) break
              }
            }
            if (foundWithData >= 2 || (foundWithData >= 1 && simplified.features.length === 1)) {
              pcodeField = pattern
              console.log(`Detected level ${level} pcode field (Mozambique pattern): ${pattern}`)
              break
            }
          }
        }
        
        // If we found a name field, add this level
        if (nameField) {
          detectedLevels.set(level, { 
            nameField, 
            pcodeField: pcodeField || `ADM${level}_PCODE` // Fallback to standard name if not found (will be null if no pcode)
          })
        }
      }
    } else {
      // Single level processing (legacy mode)
      // This would require the old form fields
      throw new Error('Please use "Process all admin levels" mode')
    }

    if (detectedLevels.size === 0) {
      // Provide helpful error message with available fields
      const sampleFields = propertyKeys.slice(0, 10).join(', ')
      const moreFields = propertyKeys.length > 10 ? ` (and ${propertyKeys.length - 10} more)` : ''
      return NextResponse.json(
        { 
          error: `No admin level fields detected. Found properties: ${sampleFields}${moreFields}. ` +
                 `Please ensure your file has fields like ADM0_EN, ADM1_EN, ADM0, ADM1, NAME_0, NAME_1, etc.`
        },
        { status: 400 }
      )
    }
    
    console.log('Detected admin levels:', Array.from(detectedLevels.entries()).map(([level, fields]) => 
      `Level ${level}: ${fields.nameField}${fields.pcodeField ? `, ${fields.pcodeField}` : ''}`
    ).join('; '))

    // Get current country config to check for existing pcode patterns
    const { data: country } = await supabase
      .from('countries')
      .select('config')
      .eq('id', countryId)
      .single()
    
    const countryConfig = (country?.config as any) || {}
    const existingPatterns = new Map<number, string>()
    if (countryConfig.adminLevels) {
      for (const levelConfig of countryConfig.adminLevels) {
        if (levelConfig.pcodePattern) {
          existingPatterns.set(levelConfig.level, levelConfig.pcodePattern)
        }
      }
    }

    // Process each level
    const summary: Record<number, number> = {}
    const allBoundariesByLevel = new Map<number, any[]>()
    const pcodeToIdMap = new Map<string, { level: number; id: string }>()
    const extractionDiagnostics = new Map<number, {
      featuresChecked: number
      featuresWithName: number
      featuresWithPcode: number
      skippedNoName: number
      skippedInvalidGeometry: number
      processedCount: number
      samplePropertyKeys: string[]
      geometryTypes?: Record<string, number>
      firstFeatureSample: any
    }>()

    // Sort levels to process from highest (Adm0) to lowest
    const sortedLevels = Array.from(detectedLevels.keys()).sort((a, b) => a - b)

    for (const level of sortedLevels) {
      const { nameField, pcodeField } = detectedLevels.get(level)!
      const boundaries: any[] = []
      const parentLevel = level > 0 ? level - 1 : null

      console.log(`Processing level ${level}: Looking for nameField="${nameField}", pcodeField="${pcodeField}"`)
      console.log(`Total features in file: ${simplified.features.length}`)
      
      // Count how many features have non-empty values for this level
      let featuresWithName = 0
      let featuresWithPcode = 0
      const sampleValues: string[] = []
      const allPropertyKeys = new Set<string>()
      
      // Check ALL features, not just first 10
      for (let i = 0; i < simplified.features.length; i++) {
        const feature = simplified.features[i]
        const props = feature?.properties || {}
        
        // Collect all property keys
        Object.keys(props).forEach(k => allPropertyKeys.add(k))
        
        // Check exact match first
        let nameValue = props[nameField]
        let pcodeValue = props[pcodeField]
        
        // If not found, try case-insensitive match
        if (nameValue === undefined || nameValue === null) {
          const matchingKey = Object.keys(props).find(k => k.toLowerCase() === nameField.toLowerCase())
          if (matchingKey) {
            nameValue = props[matchingKey]
            console.log(`Level ${level} feature ${i}: Found case-insensitive match for "${nameField}": "${matchingKey}"`)
          }
        }
        
        if (pcodeValue === undefined || pcodeValue === null) {
          const matchingKey = Object.keys(props).find(k => k.toLowerCase() === pcodeField.toLowerCase())
          if (matchingKey) {
            pcodeValue = props[matchingKey]
          }
        }
        
        if (nameValue !== undefined && nameValue !== null && String(nameValue).trim() !== '') {
          featuresWithName++
          if (sampleValues.length < 5) {
            sampleValues.push(String(nameValue).trim())
          }
        }
        if (pcodeValue !== undefined && pcodeValue !== null && String(pcodeValue).trim() !== '') {
          featuresWithPcode++
        }
      }
      
      console.log(`Level ${level} field check: ${featuresWithName}/${simplified.features.length} features have non-empty "${nameField}", ${featuresWithPcode} have "${pcodeField}"`)
      console.log(`Level ${level} all property keys found:`, Array.from(allPropertyKeys).slice(0, 20).join(', '))
      if (sampleValues.length > 0) {
        console.log(`Level ${level} sample names found:`, sampleValues)
      } else {
        console.log(`Level ${level} WARNING: No features with non-empty "${nameField}" found!`)
        // Show what the first feature actually has
        if (simplified.features.length > 0) {
          const firstFeature = simplified.features[0]
          console.log(`Level ${level} First feature properties:`, JSON.stringify(
            Object.fromEntries(
              Object.entries(firstFeature.properties || {}).slice(0, 10)
            ), null, 2
          ))
        }
      }
      
      // Sample first few features to see what we're working with
      if (simplified.features.length > 0) {
        const sampleFeature = simplified.features[0]
        console.log(`Sample feature properties for level ${level}:`, {
          nameFieldValue: sampleFeature.properties?.[nameField],
          nameFieldValueCaseInsensitive: Object.keys(sampleFeature.properties || {}).find(k => k.toLowerCase() === nameField.toLowerCase()),
          pcodeFieldValue: sampleFeature.properties?.[pcodeField],
          allProperties: Object.keys(sampleFeature.properties || {}).slice(0, 15)
        })
      }

      let skippedNoName = 0
      let skippedInvalidGeometry = 0
      let processedCount = 0
      
      for (const feature of simplified.features) {
        // Get name using the detected field name - try exact match first, then case-insensitive
        let name = feature.properties?.[nameField] || null
        
        // If not found, try case-insensitive match
        if (name === null || name === undefined) {
          const propKeys = Object.keys(feature.properties || {})
          const matchingKey = propKeys.find(k => k.toLowerCase() === nameField.toLowerCase())
          if (matchingKey) {
            name = feature.properties?.[matchingKey] || null
            console.log(`Level ${level}: Found case-insensitive match for "${nameField}": "${matchingKey}" = "${name}"`)
          }
        }
        
        // If name is empty string, null, or undefined, try to get it as string
        if (name !== null && name !== undefined) {
          name = String(name).trim()
          if (name === '') {
            name = null
          }
        }
        
        // Get pcode using the detected field name, or try fallback patterns
        let pcode = feature.properties?.[pcodeField] || null
        if (!pcode && pcodeField) {
          // Try case-insensitive match first
          const propKeys = Object.keys(feature.properties || {})
          const matchingKey = propKeys.find(k => k.toLowerCase() === pcodeField.toLowerCase())
          if (matchingKey) {
            pcode = feature.properties?.[matchingKey] || null
          }
          
          // Try alternative pcode patterns if the detected one doesn't exist
          if (!pcode) {
            const altPcodePatterns = [
              `ADM${level}_PCODE`,
              `ADM${level}_Pcode`,
              `PCODE${level}`,
              `pcode${level}`,
              `ADM${level}_CODE`,
            ]
            for (const pattern of altPcodePatterns) {
              if (feature.properties?.[pattern]) {
                pcode = feature.properties[pattern]
                break
              }
            }
          }
        }
        
        // Convert pcode to string if it exists
        if (pcode !== null && pcode !== undefined) {
          pcode = String(pcode).trim()
          if (pcode === '') {
            pcode = null
          }
        }

        if (!name) {
          skippedNoName++
          // Log why this feature was skipped (but only for first few to avoid spam)
          if (skippedNoName <= 3) {
            const rawValue = feature.properties?.[nameField]
            console.log(`Skipping feature at level ${level}: name field "${nameField}" is empty/null. Raw value:`, rawValue, 
              `Type: ${typeof rawValue}. Sample properties:`, 
              Object.entries(feature.properties || {}).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', '))
          }
          continue
        }

        const geom = feature.geometry
        if (!geom) {
          skippedInvalidGeometry++
          if (skippedInvalidGeometry <= 3) {
            console.log(`Skipping feature "${name}" at level ${level}: No geometry found`)
          }
          continue
        }
        
        // Log geometry type for first few features to diagnose
        if (skippedInvalidGeometry === 0 && processedCount === 0) {
          console.log(`Level ${level} first feature geometry:`, {
            type: geom.type,
            hasCoordinates: !!geom.coordinates,
            coordinatesLength: geom.coordinates?.length,
            fullGeometry: JSON.stringify(geom).substring(0, 200)
          })
        }
        
        if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') {
          skippedInvalidGeometry++
          if (skippedInvalidGeometry <= 3) {
            console.log(`Skipping feature "${name}" at level ${level}: Invalid geometry type "${geom.type}". Expected Polygon or MultiPolygon.`)
            if (geom.type === 'Point') {
              console.log(`  NOTE: This feature has Point geometry. Admin boundaries require Polygon/MultiPolygon geometries.`)
              console.log(`  The file appears to contain centroids (points) rather than actual boundary polygons.`)
              console.log(`  You may need a different file with polygon geometries.`)
            }
          }
          continue
        }
        
        processedCount++

        // Find parent Pcode using detected field names
        let parentPcode: string | null = null
        let parentName: string | null = null  // Also track parent name for fallback lookup
        if (parentLevel !== null) {
          const parentLevelConfig = detectedLevels.get(parentLevel)
          if (parentLevelConfig) {
            // Try the detected pcode field first
            parentPcode = feature.properties?.[parentLevelConfig.pcodeField] || null
            
            // Also get parent name for fallback lookup
            parentName = feature.properties?.[parentLevelConfig.nameField] || null
            
            // If not found, try alternative patterns
            if (!parentPcode) {
              const altPcodePatterns = [
                `adm${parentLevel}_pcode`,    // Lowercase with underscore (Mozambique format)
                `ADM${parentLevel}_PCODE`,
                `ADM${parentLevel}_Pcode`,
                `PCODE${parentLevel}`,
                `pcode${parentLevel}`,
                `ADM${parentLevel}_CODE`,
              ]
              for (const pattern of altPcodePatterns) {
                if (feature.properties?.[pattern]) {
                  parentPcode = feature.properties[pattern]
                  break
                }
              }
            }
            
            // If parent name not found, try alternative name patterns
            if (!parentName) {
              const altNamePatterns = [
                `adm${parentLevel}_name`,     // Lowercase with underscore (Mozambique format)
                `ADM${parentLevel}_NAME`,
                `ADM${parentLevel}_EN`,
                `NAME_${parentLevel}`,
              ]
              for (const pattern of altNamePatterns) {
                if (feature.properties?.[pattern]) {
                  parentName = feature.properties[pattern]
                  break
                }
              }
            }
          }
        }

        // Validate pcode against existing pattern if one exists
        // We'll store the original pcode for pattern inference, but may need to set it to null for DB insertion
        let validatedPcode = pcode
        const existingPattern = existingPatterns.get(level)
        if (pcode && existingPattern) {
          if (!validatePcode(pcode, existingPattern)) {
            // Pattern doesn't match - log warning but still try to insert
            // The DB function will validate, so we'll handle the error there
            console.warn(`Pcode "${pcode}" for ${name} (level ${level}) doesn't match pattern "${existingPattern}"`)
          }
        }

        boundaries.push({
          level,
          name,
          pcode: validatedPcode,
          originalPcode: pcode, // Keep original for pattern inference
          parentPcode,
          parentName, // Store parent name for fallback lookup
          geometry: geom, // Pass as object, not stringified
        })
      }

      // Deduplicate boundaries by name + pcode + level
      // If multiple features have the same name/pcode, merge their geometries or keep the first one
      const uniqueBoundaries = new Map<string, any>()
      for (const boundary of boundaries) {
        // Create a unique key from name, pcode, and level
        const key = `${boundary.level}:${boundary.name}:${boundary.pcode || 'null'}`
        
        if (uniqueBoundaries.has(key)) {
          // If we already have this boundary, we could merge geometries, but for now just skip duplicates
          // In the future, we could merge MultiPolygon geometries here
          console.log(`Skipping duplicate boundary: ${key}`)
          continue
        }
        
        uniqueBoundaries.set(key, boundary)
      }
      
      // Convert back to array
      const deduplicatedBoundaries = Array.from(uniqueBoundaries.values())
      
      console.log(`Level ${level}: Extracted ${boundaries.length} boundaries from ${simplified.features.length} features`)
      console.log(`Level ${level}: After deduplication: ${deduplicatedBoundaries.length} unique boundaries`)
      console.log(`Level ${level}: Skipped ${skippedNoName} features (no name), ${skippedInvalidGeometry} features (invalid geometry), ${processedCount} features processed`)
      if (deduplicatedBoundaries.length > 0) {
        console.log(`Level ${level}: Sample boundaries:`, deduplicatedBoundaries.slice(0, 3).map(b => b.name))
      } else if (processedCount > 0) {
        console.log(`Level ${level}: WARNING - ${processedCount} features were processed but ${deduplicatedBoundaries.length} boundaries were created. This may indicate a parent lookup issue.`)
      }
      
      // Collect geometry type statistics
      const geometryTypes = new Map<string, number>()
      for (const feature of simplified.features) {
        const geomType = feature.geometry?.type || 'null'
        geometryTypes.set(geomType, (geometryTypes.get(geomType) || 0) + 1)
      }
      
      // Store diagnostics for this level
      extractionDiagnostics.set(level, {
        featuresChecked: simplified.features.length,
        featuresWithName,
        featuresWithPcode,
        skippedNoName,
        skippedInvalidGeometry,
        processedCount,
        samplePropertyKeys: Array.from(allPropertyKeys).slice(0, 20),
        geometryTypes: Object.fromEntries(geometryTypes.entries()),
        firstFeatureSample: simplified.features.length > 0 ? {
          properties: Object.fromEntries(
            Object.entries(simplified.features[0].properties || {}).slice(0, 10)
          ),
          nameFieldValue: simplified.features[0].properties?.[nameField],
          nameFieldValueCaseInsensitive: Object.keys(simplified.features[0].properties || {}).find(k => k.toLowerCase() === nameField.toLowerCase()),
          geometryType: simplified.features[0].geometry?.type || 'null',
          hasGeometry: !!simplified.features[0].geometry
        } : null
      })
      
      allBoundariesByLevel.set(level, deduplicatedBoundaries)
    }
    
    // Log total boundaries found
    let totalBoundariesFound = 0
    for (const [level, boundaries] of allBoundariesByLevel.entries()) {
      totalBoundariesFound += boundaries.length
      console.log(`Level ${level}: Found ${boundaries.length} boundaries`)
    }
    console.log(`Total boundaries to process: ${totalBoundariesFound}`)

    // Insert boundaries level by level, building hierarchy
    // Also build a name-to-id map for fallback parent lookup
    const nameToIdMap = new Map<string, { level: number; id: string }>()
    
    console.log(`Starting boundary insertion for ${sortedLevels.length} admin levels`)
    for (const level of sortedLevels) {
      const boundaries = allBoundariesByLevel.get(level) || []
      console.log(`Processing level ${level}: ${boundaries.length} boundaries to insert`)
      let insertedCount = 0
      const errors: string[] = []

      for (const boundary of boundaries) {
        // Find parent ID if parent level exists
        let parentId = null
        if (level > 0) {
          // First try to find parent by pcode
          if (boundary.parentPcode) {
            const parentMapping = pcodeToIdMap.get(`${level - 1}:${boundary.parentPcode}`)
            if (parentMapping) {
              parentId = parentMapping.id
            }
          }
          
          // If pcode lookup failed, try to find parent by name (fallback)
          if (!parentId && boundary.parentName) {
            const parentNameMapping = nameToIdMap.get(`${level - 1}:${boundary.parentName}`)
            if (parentNameMapping) {
              parentId = parentNameMapping.id
              console.log(`Found parent for "${boundary.name}" by name fallback: "${boundary.parentName}" (Level ${level - 1})`)
            }
          }
          
          // Log if we couldn't find a parent (this is OK - some boundaries might not have parents)
          if (!parentId && level > 0) {
            console.log(`No parent found for "${boundary.name}" (Level ${level}). Parent pcode: ${boundary.parentPcode || 'none'}, Parent name: ${boundary.parentName || 'none'}. Will insert without parent.`)
          }
        }

        // Validate geometry before sending
        if (!boundary.geometry || typeof boundary.geometry !== 'object') {
          errors.push(`${boundary.name}: Invalid geometry`)
          continue
        }

        const geom = boundary.geometry as any
        if (!geom.type || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
          errors.push(`${boundary.name}: Geometry must be Polygon or MultiPolygon, got ${geom.type}`)
          continue
        }

        try {
          // Use service role client to bypass RLS policies
          const rpcParams = {
            p_country_id: countryId,
            p_level: boundary.level,
            p_name: boundary.name,
            p_pcode: boundary.pcode || null,
            p_parent_id: parentId,
            p_geometry: geom as any, // Pass as JSONB object
          }
          
          console.log(`Calling insert_admin_boundary for ${boundary.name} (Level ${level})`, {
            countryId,
            level: boundary.level,
            name: boundary.name,
            hasPcode: !!boundary.pcode,
            hasParent: !!parentId,
            geometryType: geom.type
          })
          
          const { data: insertedId, error } = await serviceRoleSupabase.rpc('insert_admin_boundary', rpcParams)
          
          if (error) {
            // If error is about pattern mismatch, try inserting without pcode
            if (error.message?.toLowerCase().includes('pattern') && boundary.pcode) {
              console.warn(`Pcode "${boundary.pcode}" for "${boundary.name}" doesn't match pattern. Retrying without pcode...`)
              const { data: retryId, error: retryError } = await serviceRoleSupabase.rpc('insert_admin_boundary', {
                p_country_id: countryId,
                p_level: boundary.level,
                p_name: boundary.name,
                p_pcode: null, // Insert without pcode
                p_parent_id: parentId,
                p_geometry: geom as any,
              })
              
              if (retryError) {
                const errorMsg = `${boundary.name}: ${retryError.message}`
                errors.push(errorMsg)
                console.error(`Error inserting boundary ${boundary.name} (retry):`, retryError.message, retryError.details, retryError.hint)
              } else if (retryId) {
                insertedCount++
                // Still track the original pcode for pattern inference
                if (boundary.pcode) {
                  pcodeToIdMap.set(`${level}:${boundary.pcode}`, { level, id: retryId })
                }
                // Also store in name-to-id map for fallback parent lookup
                nameToIdMap.set(`${level}:${boundary.name}`, { level, id: retryId })
              }
          } else {
            const errorMsg = `${boundary.name}: ${error.message}`
            errors.push(errorMsg)
            console.error(`Error inserting boundary ${boundary.name} (Level ${level}):`, {
              message: error.message,
              details: error.details,
              hint: error.hint,
              code: error.code,
              boundary: {
                name: boundary.name,
                level: boundary.level,
                hasPcode: !!boundary.pcode,
                hasParent: !!parentId,
                geometryType: geom.type
              }
            })
          }
          } else if (insertedId) {
            insertedCount++
            console.log(`Successfully inserted boundary ${boundary.name} (Level ${level}) with ID: ${insertedId}`)
            if (boundary.pcode) {
              pcodeToIdMap.set(`${level}:${boundary.pcode}`, { level, id: insertedId })
            }
            // Also store in name-to-id map for fallback parent lookup
            nameToIdMap.set(`${level}:${boundary.name}`, { level, id: insertedId })
          } else {
            const errorMsg = `${boundary.name}: Function returned null (no ID returned)`
            errors.push(errorMsg)
            console.error(`Function returned null for boundary ${boundary.name} (Level ${level}). Response:`, { data: insertedId, error: null })
          }
        } catch (e: any) {
          errors.push(`${boundary.name}: ${e.message || 'Unknown error'}`)
          console.error(`Exception inserting boundary ${boundary.name}:`, e)
        }
      }
      
      if (errors.length > 0 && insertedCount === 0) {
        // If all failed, throw error with details
        console.error(`Level ${level}: All ${boundaries.length} boundaries failed to insert. Errors:`, errors.slice(0, 10))
        throw new Error(`Failed to insert boundaries at level ${level}. First error: ${errors[0]}. Total errors: ${errors.length}`)
      } else if (errors.length > 0) {
        // Log warnings but continue
        console.warn(`Level ${level}: ${insertedCount} inserted, ${errors.length} failed. Sample errors: ${errors.slice(0, 3).join('; ')}`)
      } else if (insertedCount > 0) {
        console.log(`Level ${level}: Successfully inserted ${insertedCount} boundaries`)
      }

      summary[level] = insertedCount
    }

    // Infer Pcode patterns from uploaded data and update country config
    let inferredPatterns: Map<number, string> = new Map()
    
    if (allBoundariesByLevel.size > 0) {
      inferredPatterns = inferPcodePatternsFromBoundaries(allBoundariesByLevel)
      
      // Get current country config
      const { data: country } = await supabase
        .from('countries')
        .select('config')
        .eq('id', countryId)
        .single()
      
      if (country && country.config) {
        const config = country.config as any
        if (config.adminLevels) {
          // Update patterns for each level
          config.adminLevels = config.adminLevels.map((levelConfig: any) => {
            const inferred = inferredPatterns.get(levelConfig.level)
            if (inferred) {
              return { ...levelConfig, pcodePattern: inferred }
            }
            return levelConfig
          })
          
          // Save updated config (use service role to bypass RLS)
          const { error: configError } = await serviceRoleSupabase
            .from('countries')
            .update({ config, updated_at: new Date().toISOString() })
            .eq('id', countryId)
          
          if (configError) {
            console.error('Failed to update country config:', configError)
            // Don't fail the whole upload if config update fails
          }
        }
      }
    }

    // Check if any boundaries were actually inserted
    const totalInserted = Object.values(summary).reduce((sum: number, count: any) => sum + count, 0)
    const totalProcessed = Array.from(allBoundariesByLevel.values()).reduce((sum, boundaries) => sum + boundaries.length, 0)
    
    // Use the geometry types we collected earlier, or collect them now if not available
    const allGeometryTypes = new Map<string, number>()
    if (fileGeometryTypes && Object.keys(fileGeometryTypes).length > 0) {
      // Use the types we collected earlier
      for (const [type, count] of Object.entries(fileGeometryTypes)) {
        allGeometryTypes.set(type, count)
      }
    } else if (simplified && simplified.features) {
      // Fallback: collect them now
      for (const feature of simplified.features) {
        const geomType = feature.geometry?.type || 'null'
        allGeometryTypes.set(geomType, (allGeometryTypes.get(geomType) || 0) + 1)
      }
    }
    
    if (totalInserted === 0) {
      console.error('=== BOUNDARY INSERTION FAILURE DEBUG ===')
      console.error('Total boundaries processed:', totalProcessed)
      console.error('Total boundaries inserted:', totalInserted)
      console.error('Summary by level:', summary)
      console.error('Detected levels:', Array.from(detectedLevels.entries()))
      console.error('Boundaries by level:', Object.fromEntries(
        Array.from(allBoundariesByLevel.entries()).map(([level, boundaries]) => [
          level,
          { count: boundaries.length, sampleNames: boundaries.slice(0, 3).map(b => b.name) }
        ])
      ))
      console.error('Geometry types in file:', Object.fromEntries(allGeometryTypes.entries()))
      console.error('========================================')
      
      // Collect all errors from all levels
      const allErrors: string[] = []
      for (const level of sortedLevels) {
        const boundaries = allBoundariesByLevel.get(level) || []
        if (boundaries.length > 0 && summary[level] === 0) {
          allErrors.push(`Level ${level}: ${boundaries.length} boundaries processed, 0 inserted`)
        }
      }
      
      // Create a more helpful error message based on what we know
      let errorMessage = `No boundaries were inserted. Processed ${totalProcessed} boundaries across ${detectedLevels.size} admin levels, but none were inserted.`
      
      // Calculate total skipped invalid geometry from diagnostics
      const totalSkippedInvalidGeometry = Array.from(extractionDiagnostics.values())
        .reduce((sum, diag) => sum + diag.skippedInvalidGeometry, 0)
      
      // Check if all features were skipped due to geometry issues
      const geometryTypeEntries = Array.from(allGeometryTypes.entries())
      if (geometryTypeEntries.length > 0) {
        const geometryTypeInfo = geometryTypeEntries.map(([type, count]) => `${type}: ${count}`).join(', ')
        errorMessage += `\n\nGeometry types found in file: ${geometryTypeInfo}`
        
        // Check if we have Point geometries
        const pointCount = allGeometryTypes.get('Point') || 0
        if (pointCount > 0) {
          errorMessage += `\n\n⚠️ WARNING: Your file contains ${pointCount} Point geometries. Admin boundaries require Polygon or MultiPolygon geometries (actual boundary shapes), not Point geometries (centroids).`
          errorMessage += `\n\nPlease use a file that contains polygon boundaries, not point locations.`
        } else if (totalProcessed === 0 && totalSkippedInvalidGeometry > 0) {
          errorMessage += `\n\nAll ${totalSkippedInvalidGeometry} features were skipped due to invalid geometry types. Expected Polygon or MultiPolygon.`
        }
      }
      
      errorMessage += `\n\nThis may also be due to database errors or RLS policy restrictions. Check server logs for detailed error messages.`
      
      return NextResponse.json(
        { 
          error: errorMessage,
          summary,
          debug: {
            totalProcessed,
            totalInserted,
            detectedLevels: Array.from(detectedLevels.entries()).map(([level, fields]) => ({
              level,
              nameField: fields.nameField,
              pcodeField: fields.pcodeField
            })),
            boundariesByLevel: Object.fromEntries(
              Array.from(allBoundariesByLevel.entries()).map(([level, boundaries]) => [
                level,
                { count: boundaries.length, sampleNames: boundaries.slice(0, 3).map(b => b.name) }
              ])
            ),
            extractionDiagnostics: Object.fromEntries(
              Array.from(extractionDiagnostics.entries()).map(([level, diag]) => [
                level,
                diag
              ])
            ),
            geometryTypesInFile: Object.fromEntries(allGeometryTypes.entries()),
            errors: allErrors
          }
        },
        { status: 400 }
      )
    }

    return NextResponse.json({ 
      summary, 
      success: true,
      patternsInferred: Array.from(inferredPatterns.entries()),
      totalInserted
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    )
  }
}

async function fetchFromHDX(url: string): Promise<any> {
  // HDX API integration - simplified version
  // In production, you'd need to:
  // 1. Parse the HDX dataset page
  // 2. Find the GeoJSON/Shapefile download URL
  // 3. Fetch and parse it

  // For now, return an error asking for direct GeoJSON URL
  throw new Error(
    'HDX direct integration coming soon. Please download the GeoJSON file and upload it directly, or provide a direct GeoJSON URL.'
  )
}

async function processFileFromStorage(supabase: any, filePath: string): Promise<any> {
  // Download file from Supabase Storage
  // Use service role client for server-side access
  const { createClient } = await import('@supabase/supabase-js')
  const serviceRoleClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  const { data: fileData, error: downloadError } = await serviceRoleClient.storage
    .from('admin-boundaries')
    .download(filePath)

  if (downloadError) {
    console.error('Storage download error:', downloadError)
    throw new Error(`Failed to download file from storage: ${downloadError.message}. File path: ${filePath}`)
  }

  if (!fileData) {
    throw new Error(`No file data returned from storage for path: ${filePath}`)
  }

  // Convert Blob to File-like object for processing
  const fileName = filePath.split('/').pop() || 'file'
  const file = new File([fileData], fileName, { type: fileData.type || 'application/octet-stream' })
  
  return processFile(file)
}

async function processFile(file: File): Promise<any> {
  const fileName = file.name.toLowerCase()

  if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
    const text = await file.text()
    try {
      return JSON.parse(text)
    } catch (e) {
      throw new Error(`Invalid GeoJSON file: ${(e as Error).message}`)
    }
  } else if (fileName.endsWith('.zip')) {
    // Handle zip files - could contain Shapefile or GeoJSON
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)
    
    // Get all files in the zip
    const allFiles: Array<{ path: string; file: JSZip.JSZipObject }> = []
    zip.forEach((relativePath, file) => {
      if (!file.dir) {
        allFiles.push({ path: relativePath, file })
      }
    })
    
    // Check for GDB (File Geodatabase) - these are typically .gdb.zip files
    const isGDB = fileName.toLowerCase().endsWith('.gdb.zip') || 
                  fileName.toLowerCase().includes('.gdb') ||
                  allFiles.some(f => f.path.toLowerCase().includes('.gdb'))
    
    if (isGDB) {
      throw new Error(
        'File Geodatabase (.gdb) format is not yet supported. ' +
        'Please convert your GDB file to Shapefile (.shp) or GeoJSON format. ' +
        'You can use tools like QGIS, ArcGIS, or ogr2ogr to convert GDB to Shapefile.'
      )
    }
    
    // Check for GeoJSON files first (if someone zipped GeoJSON files)
    const geojsonFiles = allFiles.filter(f => {
      const lowerPath = f.path.toLowerCase()
      return lowerPath.endsWith('.geojson') || lowerPath.endsWith('.json')
    })
    
    if (geojsonFiles.length > 0) {
      // Check if we have multiple admin level files (e.g., moz_admin0.geojson, moz_admin1.geojson)
      // If so, merge them into one FeatureCollection
      const adminLevelFiles = geojsonFiles.filter(f => {
        const lowerPath = f.path.toLowerCase()
        return /admin\d+\.(geojson|json)$/i.test(lowerPath) || 
               /adm\d+\.(geojson|json)$/i.test(lowerPath)
      })
      
      if (adminLevelFiles.length > 1) {
        // Multiple admin level files - merge them
        console.log(`Found ${adminLevelFiles.length} admin level GeoJSON files, merging...`)
        const allFeatures: any[] = []
        
        for (const adminFile of adminLevelFiles) {
          const geojsonText = await adminFile.file.async('string')
          try {
            const geojson = JSON.parse(geojsonText)
            if (geojson.type === 'FeatureCollection' && geojson.features) {
              allFeatures.push(...geojson.features)
              console.log(`  Added ${geojson.features.length} features from ${adminFile.path}`)
            }
          } catch (e) {
            console.warn(`Failed to parse ${adminFile.path}: ${(e as Error).message}`)
          }
        }
        
        if (allFeatures.length > 0) {
          console.log(`Merged ${allFeatures.length} total features from ${adminLevelFiles.length} files`)
          return featureCollection(allFeatures)
        }
      }
      
      // Single GeoJSON file or non-admin-level files - process the first one
      const selectedGeoJSON = geojsonFiles[0]
      const geojsonText = await selectedGeoJSON.file.async('string')
      try {
        const geojson = JSON.parse(geojsonText)
        if (!geojson.type || geojson.type !== 'FeatureCollection') {
          throw new Error('Invalid GeoJSON: must be a FeatureCollection')
        }
        console.log(`Found GeoJSON file in zip: ${selectedGeoJSON.path} with ${geojson.features?.length || 0} features`)
        return geojson
      } catch (e) {
        throw new Error(`Failed to parse GeoJSON from zip: ${(e as Error).message}`)
      }
    }
    
    // If no GeoJSON, look for Shapefile
    const shpFiles = allFiles.filter(f => f.path.toLowerCase().endsWith('.shp'))
    
    if (shpFiles.length === 0) {
      const fileList = allFiles.map(f => f.path).slice(0, 10).join(', ')
      throw new Error(
        `No .shp or .geojson files found in zip. Found files: ${fileList || 'none'}. ` +
        `Please ensure your zip contains either .shp files (Shapefile) or .geojson/.json files (GeoJSON).`
      )
    }
    
    // For COD files, typically there's one shapefile with all admin levels
    // Try to find the main one (usually the largest or has 'adm' in name)
    let selectedShp = shpFiles[0]
    for (const shp of shpFiles) {
      const lowerPath = shp.path.toLowerCase()
      if (lowerPath.includes('adm') && !lowerPath.includes('adm0') && !lowerPath.includes('adm1')) {
        selectedShp = shp
        break
      }
    }
    
    // Find corresponding .dbf file (same base name)
    const basePath = selectedShp.path.replace(/\.shp$/i, '')
    const dbfFile = allFiles.find(f => 
      f.path.toLowerCase() === `${basePath}.dbf`.toLowerCase()
    )
    
    if (!dbfFile) {
      const dbfFiles = allFiles.filter(f => f.path.toLowerCase().endsWith('.dbf'))
      throw new Error(
        `No matching .dbf file found for ${selectedShp.path}. ` +
        `Found .dbf files: ${dbfFiles.map(f => f.path).join(', ')}. ` +
        `The .shp and .dbf files must have the same base name.`
      )
    }

    const shpBuffer = await selectedShp.file.async('arraybuffer')
    const dbfBuffer = await dbfFile.file.async('arraybuffer')

    // Convert shapefile to GeoJSON
    try {
      const source = await shp.open(shpBuffer, dbfBuffer)
      const features: any[] = []

      let result = await source.read()
      let featureCount = 0
      const geometryTypes = new Map<string, number>()
      
      while (!result.done) {
        if (result.value) {
          features.push(result.value)
          featureCount++
          
          // Track geometry types
          const geomType = result.value.geometry?.type || 'null'
          geometryTypes.set(geomType, (geometryTypes.get(geomType) || 0) + 1)
          
          // Log first few geometry types for debugging
          if (featureCount <= 3) {
            console.log(`Feature ${featureCount} geometry type: ${geomType}`)
          }
        }
        result = await source.read()
      }
      
      console.log(`Shapefile contains ${featureCount} features`)
      console.log(`Geometry type distribution:`, Object.fromEntries(geometryTypes.entries()))

      if (features.length === 0) {
        throw new Error('Shapefile contains no features')
      }
      
      // Warn if we have Point geometries
      const pointCount = geometryTypes.get('Point') || 0
      if (pointCount > 0) {
        console.warn(`⚠️ WARNING: Shapefile contains ${pointCount} Point geometries. Admin boundaries require Polygon or MultiPolygon geometries.`)
      }

      return featureCollection(features)
    } catch (e) {
      throw new Error(`Failed to parse shapefile: ${(e as Error).message}`)
    }
  } else {
    throw new Error('Unsupported file format. Use GeoJSON (.geojson, .json) or Shapefile (.zip)')
  }
}

