export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'viewer' | 'global_admin'
export type DatasetStatus = 'uploading' | 'validating' | 'processing' | 'complete' | 'error'
export type CalculationStatus = 'running' | 'complete' | 'error'
export type SeverityLevel = 'critical' | 'severe' | 'moderate' | 'minimal'

export interface Database {
  public: {
    Tables: {
      countries: {
        Row: {
          id: string
          name: string
          code: string
          config: Json
          is_public: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          code: string
          config?: Json
          is_public?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          code?: string
          config?: Json
          is_public?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      admin_boundaries: {
        Row: {
          id: string
          country_id: string
          level: number
          name: string
          pcode: string | null
          parent_id: string | null
          geometry: unknown
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          country_id: string
          level: number
          name: string
          pcode?: string | null
          parent_id?: string | null
          geometry?: unknown
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          country_id?: string
          level?: number
          name?: string
          pcode?: string | null
          parent_id?: string | null
          geometry?: unknown
          metadata?: Json
          created_at?: string
        }
      }
      datasets: {
        Row: {
          id: string
          country_id: string
          type_id: string | null
          name: string
          version: string | null
          status: DatasetStatus
          file_path: string | null
          metadata: Json
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          country_id: string
          type_id?: string | null
          name: string
          version?: string | null
          status?: DatasetStatus
          file_path?: string | null
          metadata?: Json
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          country_id?: string
          type_id?: string | null
          name?: string
          version?: string | null
          status?: DatasetStatus
          file_path?: string | null
          metadata?: Json
          uploaded_at?: string
          uploaded_by?: string | null
        }
      }
      hazards: {
        Row: {
          id: string
          country_id: string
          type: string
          name: string
          geometry: unknown
          affected_areas: Json
          date: string | null
          metadata: Json
          uploaded_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          country_id: string
          type: string
          name: string
          geometry?: unknown
          affected_areas?: Json
          date?: string | null
          metadata?: Json
          uploaded_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          country_id?: string
          type?: string
          name?: string
          geometry?: unknown
          affected_areas?: Json
          date?: string | null
          metadata?: Json
          uploaded_by?: string | null
          created_at?: string
        }
      }
      calculation_models: {
        Row: {
          id: string
          name: string
          version: string
          description: string | null
          country_id: string | null
          model_config: Json
          source_file_path: string | null
          source_metadata: Json | null
          is_active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          version: string
          description?: string | null
          country_id?: string | null
          model_config: Json
          source_file_path?: string | null
          source_metadata?: Json | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          version?: string
          description?: string | null
          country_id?: string | null
          model_config?: Json
          source_file_path?: string | null
          source_metadata?: Json | null
          is_active?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      household_datasets: {
        Row: {
          id: string
          country_id: string
          dataset_id: string | null
          name: string
          description: string | null
          file_path: string | null
          total_households: number
          status: DatasetStatus
          metadata: Json | null
          processed_at: string | null
          uploaded_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          country_id: string
          dataset_id?: string | null
          name: string
          description?: string | null
          file_path?: string | null
          total_households?: number
          status?: DatasetStatus
          metadata?: Json | null
          processed_at?: string | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          country_id?: string
          dataset_id?: string | null
          name?: string
          description?: string | null
          file_path?: string | null
          total_households?: number
          status?: DatasetStatus
          metadata?: Json | null
          processed_at?: string | null
          uploaded_by?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      household_records: {
        Row: {
          id: string
          household_dataset_id: string
          admin_boundary_id: string | null
          pcode: string | null
          household_id: string | null
          survey_responses: Json
          population_group: string | null
          pillar1_score: number | null
          pillar2_score: number | null
          pillar3_score: number | null
          final_severity: number | null
          calculated_at: string | null
          calculation_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          household_dataset_id: string
          admin_boundary_id?: string | null
          pcode?: string | null
          household_id?: string | null
          survey_responses: Json
          population_group?: string | null
          pillar1_score?: number | null
          pillar2_score?: number | null
          pillar3_score?: number | null
          final_severity?: number | null
          calculated_at?: string | null
          calculation_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          household_dataset_id?: string
          admin_boundary_id?: string | null
          pcode?: string | null
          household_id?: string | null
          survey_responses?: Json
          population_group?: string | null
          pillar1_score?: number | null
          pillar2_score?: number | null
          pillar3_score?: number | null
          final_severity?: number | null
          calculated_at?: string | null
          calculation_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      severity_calculations: {
        Row: {
          id: string
          country_id: string
          calculation_model_id: string | null
          household_dataset_id: string | null
          model_config: Json
          results: Json | null
          status: CalculationStatus
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          country_id: string
          calculation_model_id?: string | null
          household_dataset_id?: string | null
          model_config: Json
          results?: Json | null
          status?: CalculationStatus
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          country_id?: string
          calculation_model_id?: string | null
          household_dataset_id?: string | null
          model_config?: Json
          results?: Json | null
          status?: CalculationStatus
          created_at?: string
          created_by?: string | null
        }
      }
      pin_results: {
        Row: {
          id: string
          calculation_id: string
          admin_boundary_id: string
          severity_level: SeverityLevel | null
          pin_count: number | null
          breakdown: Json
          created_at: string
        }
        Insert: {
          id?: string
          calculation_id: string
          admin_boundary_id: string
          severity_level?: SeverityLevel | null
          pin_count?: number | null
          breakdown?: Json
          created_at?: string
        }
        Update: {
          id?: string
          calculation_id?: string
          admin_boundary_id?: string
          severity_level?: SeverityLevel | null
          pin_count?: number | null
          breakdown?: Json
          created_at?: string
        }
      }
    }
  }
}

