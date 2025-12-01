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
          // Mozambique pattern: name, name1, name2, name3 (check these first)
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
          `PCODE${level}`,       // Alternative: PCODE0, PCODE1
          `pcode${level}`,       // Lowercase
          `ADM${level}_CODE`,    // Alternative: ADM0_CODE
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
          
          if (foundWithData >= 1) {
            nameField = pattern
            console.log(`Detected level ${level} name field: ${pattern} = "${firstNonEmptyValue}" (found in ${foundWithData} of ${Math.min(20, simplified.features.length)} checked features)`)
            break
          }
        }
        
        // Find matching pcode field (optional)
        let pcodeField: string | null = null
        for (const pattern of pcodePatterns) {
          if (properties[pattern] !== undefined && properties[pattern] !== null && properties[pattern] !== '') {
            pcodeField = pattern
            break
          }
        }
        
        // For Mozambique pattern, also check for pcode variants
        if (nameField && !pcodeField) {
          // Try common pcode patterns that might match Mozambique format
          const mozPcodePatterns = [
            `pcode${level}`,
            `pcode_${level}`,
            `code${level}`,
            `code_${level}`,
            `ADM${level}_PCODE`,
          ]
          for (const pattern of mozPcodePatterns) {
            if (properties[pattern] !== undefined && properties[pattern] !== null && properties[pattern] !== '') {
              pcodeField = pattern
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
      
      for (let i = 0; i < Math.min(10, simplified.features.length); i++) {
        const feature = simplified.features[i]
        const nameValue = feature?.properties?.[nameField]
        const pcodeValue = feature?.properties?.[pcodeField]
        
        if (nameValue !== undefined && nameValue !== null && String(nameValue).trim() !== '') {
          featuresWithName++
          if (sampleValues.length < 3) {
            sampleValues.push(String(nameValue).trim())
          }
        }
        if (pcodeValue !== undefined && pcodeValue !== null && String(pcodeValue).trim() !== '') {
          featuresWithPcode++
        }
      }
      
      console.log(`Level ${level} field check: ${featuresWithName}/${Math.min(10, simplified.features.length)} features have non-empty "${nameField}", ${featuresWithPcode} have "${pcodeField}"`)
      if (sampleValues.length > 0) {
        console.log(`Level ${level} sample names:`, sampleValues)
      }
      
      // Sample first few features to see what we're working with
      if (simplified.features.length > 0) {
        const sampleFeature = simplified.features[0]
        console.log(`Sample feature properties for level ${level}:`, {
          nameFieldValue: sampleFeature.properties?.[nameField],
          pcodeFieldValue: sampleFeature.properties?.[pcodeField],
          allProperties: Object.keys(sampleFeature.properties || {}).slice(0, 15)
        })
      }

      for (const feature of simplified.features) {
        // Get name using the detected field name
        let name = feature.properties?.[nameField] || null
        
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
          // Try alternative pcode patterns if the detected one doesn't exist
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
        
        // Convert pcode to string if it exists
        if (pcode !== null && pcode !== undefined) {
          pcode = String(pcode).trim()
          if (pcode === '') {
            pcode = null
          }
        }

        if (!name) {
          // Log why this feature was skipped (but only for first few to avoid spam)
          if (boundaries.length < 3) {
            console.log(`Skipping feature at level ${level}: name field "${nameField}" is empty or null. Sample properties:`, 
              Object.entries(feature.properties || {}).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', '))
          }
          continue
        }

        const geom = feature.geometry
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) {
          if (boundaries.length < 3) {
            console.log(`Skipping feature "${name}" at level ${level}: Invalid geometry type ${geom?.type || 'null'}`)
          }
          continue
        }

        // Find parent Pcode using detected field names
        let parentPcode: string | null = null
        if (parentLevel !== null) {
          const parentLevelConfig = detectedLevels.get(parentLevel)
          if (parentLevelConfig) {
            // Try the detected pcode field first
            parentPcode = feature.properties?.[parentLevelConfig.pcodeField] || null
            // If not found, try alternative patterns
            if (!parentPcode) {
              const altPatterns = [
                `ADM${parentLevel}_PCODE`,
                `ADM${parentLevel}_Pcode`,
                `PCODE${parentLevel}`,
                `pcode${parentLevel}`,
                `ADM${parentLevel}_CODE`,
              ]
              for (const pattern of altPatterns) {
                if (feature.properties?.[pattern]) {
                  parentPcode = feature.properties[pattern]
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
          geometry: geom, // Pass as object, not stringified
        })
      }

      console.log(`Level ${level}: Extracted ${boundaries.length} boundaries from ${simplified.features.length} features`)
      if (boundaries.length > 0) {
        console.log(`Level ${level}: Sample boundaries:`, boundaries.slice(0, 3).map(b => b.name))
      }
      allBoundariesByLevel.set(level, boundaries)
    }
    
    // Log total boundaries found
    let totalBoundariesFound = 0
    for (const [level, boundaries] of allBoundariesByLevel.entries()) {
      totalBoundariesFound += boundaries.length
      console.log(`Level ${level}: Found ${boundaries.length} boundaries`)
    }
    console.log(`Total boundaries to process: ${totalBoundariesFound}`)

    // Insert boundaries level by level, building hierarchy
    console.log(`Starting boundary insertion for ${sortedLevels.length} admin levels`)
    for (const level of sortedLevels) {
      const boundaries = allBoundariesByLevel.get(level) || []
      console.log(`Processing level ${level}: ${boundaries.length} boundaries to insert`)
      let insertedCount = 0
      const errors: string[] = []

      for (const boundary of boundaries) {
        // Find parent ID if parent level exists
        let parentId = null
        if (boundary.parentPcode && level > 0) {
          const parentMapping = pcodeToIdMap.get(`${level - 1}:${boundary.parentPcode}`)
          if (parentMapping) {
            parentId = parentMapping.id
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
      console.error('========================================')
      
      // Collect all errors from all levels
      const allErrors: string[] = []
      for (const level of sortedLevels) {
        const boundaries = allBoundariesByLevel.get(level) || []
        if (boundaries.length > 0 && summary[level] === 0) {
          allErrors.push(`Level ${level}: ${boundaries.length} boundaries processed, 0 inserted`)
        }
      }
      
      return NextResponse.json(
        { 
          error: `No boundaries were inserted. Processed ${totalProcessed} boundaries across ${detectedLevels.size} admin levels, but none were inserted. This may be due to database errors, invalid geometries, or RLS policy restrictions. Check server logs for detailed error messages.`,
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
    // Handle shapefile - COD files often have multiple shapefiles, we'll process the first one
    const arrayBuffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuffer)
    
    // Get all files in the zip
    const allFiles: Array<{ path: string; file: JSZip.JSZipObject }> = []
    zip.forEach((relativePath, file) => {
      if (!file.dir) {
        allFiles.push({ path: relativePath, file })
      }
    })
    
    // Find all .shp files (COD files may have multiple - one per admin level)
    const shpFiles = allFiles.filter(f => f.path.toLowerCase().endsWith('.shp'))
    
    if (shpFiles.length === 0) {
      const fileList = allFiles.map(f => f.path).slice(0, 10).join(', ')
      throw new Error(
        `No .shp files found in zip. Found files: ${fileList || 'none'}. ` +
        `Please ensure your zip contains .shp files.`
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
      while (!result.done) {
        if (result.value) {
          features.push(result.value)
        }
        result = await source.read()
      }

      if (features.length === 0) {
        throw new Error('Shapefile contains no features')
      }

      return featureCollection(features)
    } catch (e) {
      throw new Error(`Failed to parse shapefile: ${(e as Error).message}`)
    }
  } else {
    throw new Error('Unsupported file format. Use GeoJSON (.geojson, .json) or Shapefile (.zip)')
  }
}

