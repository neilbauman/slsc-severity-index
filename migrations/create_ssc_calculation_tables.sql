-- Create calculation_models table for storing SSC calculation model configurations
CREATE TABLE IF NOT EXISTS calculation_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  country_id UUID REFERENCES countries(id) ON DELETE CASCADE,
  model_config JSONB NOT NULL, -- Stores the parsed CalculationModelConfig
  source_file_path TEXT, -- Original Excel file path if imported
  source_metadata JSONB, -- Additional metadata from source
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, version, country_id)
);

-- Create household_datasets table for storing household-level survey datasets
CREATE TABLE IF NOT EXISTS household_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  dataset_id UUID REFERENCES datasets(id) ON DELETE SET NULL, -- Reference to source dataset file
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT, -- Path to original file in storage
  total_households INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing', -- processing, complete, error
  metadata JSONB, -- Additional metadata about the dataset
  processed_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create household_records table for storing individual household survey records
CREATE TABLE IF NOT EXISTS household_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_dataset_id UUID NOT NULL REFERENCES household_datasets(id) ON DELETE CASCADE,
  admin_boundary_id UUID REFERENCES admin_boundaries(id) ON DELETE SET NULL,
  pcode TEXT, -- Administrative pcode for linking
  household_id TEXT, -- Original household ID from survey
  survey_responses JSONB NOT NULL, -- Raw survey responses
  population_group TEXT, -- e.g., "Internally displaced persons (IDP)", "Host community"
  pillar1_score NUMERIC, -- Calculated pillar 1 score (0-5)
  pillar2_score NUMERIC, -- Calculated pillar 2 score (0-5)
  pillar3_score NUMERIC, -- Calculated pillar 3 score (0-5)
  final_severity INTEGER, -- Final severity score (1-5) from decision tree
  calculated_at TIMESTAMPTZ,
  calculation_id UUID REFERENCES severity_calculations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Update severity_calculations to link to calculation model
ALTER TABLE severity_calculations 
  ADD COLUMN IF NOT EXISTS calculation_model_id UUID REFERENCES calculation_models(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS household_dataset_id UUID REFERENCES household_datasets(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_calculation_models_country_id ON calculation_models(country_id);
CREATE INDEX IF NOT EXISTS idx_calculation_models_is_active ON calculation_models(is_active);
CREATE INDEX IF NOT EXISTS idx_calculation_models_name_version ON calculation_models(name, version);

CREATE INDEX IF NOT EXISTS idx_household_datasets_country_id ON household_datasets(country_id);
CREATE INDEX IF NOT EXISTS idx_household_datasets_dataset_id ON household_datasets(dataset_id);
CREATE INDEX IF NOT EXISTS idx_household_datasets_status ON household_datasets(status);

CREATE INDEX IF NOT EXISTS idx_household_records_dataset_id ON household_records(household_dataset_id);
CREATE INDEX IF NOT EXISTS idx_household_records_admin_boundary_id ON household_records(admin_boundary_id);
CREATE INDEX IF NOT EXISTS idx_household_records_pcode ON household_records(pcode);
CREATE INDEX IF NOT EXISTS idx_household_records_calculation_id ON household_records(calculation_id);
CREATE INDEX IF NOT EXISTS idx_household_records_final_severity ON household_records(final_severity);

CREATE INDEX IF NOT EXISTS idx_severity_calculations_model_id ON severity_calculations(calculation_model_id);
CREATE INDEX IF NOT EXISTS idx_severity_calculations_household_dataset_id ON severity_calculations(household_dataset_id);

-- Enable RLS
ALTER TABLE calculation_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_records ENABLE ROW LEVEL SECURITY;

-- RLS Policies for calculation_models
-- Allow public read access (calculation models are reference data)
CREATE POLICY "Public can view calculation models"
  ON calculation_models FOR SELECT
  USING (true);

-- Allow authenticated users to create/update calculation models
CREATE POLICY "Authenticated users can manage calculation models"
  ON calculation_models FOR ALL
  USING (auth.role() = 'authenticated');

-- RLS Policies for household_datasets
-- Allow public read access
CREATE POLICY "Public can view household datasets"
  ON household_datasets FOR SELECT
  USING (true);

-- Allow authenticated users to create/update household datasets
CREATE POLICY "Authenticated users can manage household datasets"
  ON household_datasets FOR ALL
  USING (auth.role() = 'authenticated');

-- RLS Policies for household_records
-- Allow public read access
CREATE POLICY "Public can view household records"
  ON household_records FOR SELECT
  USING (true);

-- Allow authenticated users to create/update household records
CREATE POLICY "Authenticated users can manage household records"
  ON household_records FOR ALL
  USING (auth.role() = 'authenticated');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to update updated_at
CREATE TRIGGER update_calculation_models_updated_at BEFORE UPDATE ON calculation_models
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_household_datasets_updated_at BEFORE UPDATE ON household_datasets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_household_records_updated_at BEFORE UPDATE ON household_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

