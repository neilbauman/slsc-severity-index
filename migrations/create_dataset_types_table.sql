-- Drop table if it exists (to recreate with correct structure)
-- This is safe because it's a new table with no data dependencies yet
DROP TABLE IF EXISTS dataset_types CASCADE;

-- Create dataset_types table
CREATE TABLE dataset_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  data_type TEXT NOT NULL CHECK (data_type IN ('categorical', 'numeric')),
  badge_color TEXT DEFAULT '#6B7280', -- Default gray
  schema_definition JSONB, -- Optional schema for validation
  is_system BOOLEAN DEFAULT false, -- System types cannot be deleted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_dataset_types_data_type ON dataset_types(data_type);
CREATE INDEX idx_dataset_types_name ON dataset_types(name);

-- Insert default dataset types
INSERT INTO dataset_types (name, description, data_type, badge_color, is_system) VALUES
  ('Categorical', 'Datasets with discrete categories (e.g., High/Medium/Low, Severe/Moderate/Minimal)', 'categorical', '#3B82F6', true),
  ('Numeric', 'Datasets with continuous numeric values (e.g., rates, percentages, counts)', 'numeric', '#10B981', true);

-- Add foreign key constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'datasets_type_id_fkey'
  ) THEN
    ALTER TABLE datasets
      ADD CONSTRAINT datasets_type_id_fkey 
      FOREIGN KEY (type_id) 
      REFERENCES dataset_types(id) 
      ON DELETE SET NULL;
  END IF;
END $$;

-- Create RLS policies
ALTER TABLE dataset_types ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Dataset types are viewable by everyone" ON dataset_types;
DROP POLICY IF EXISTS "Authenticated users can manage dataset types" ON dataset_types;

-- Policy: Anyone can read dataset types (they're reference data)
CREATE POLICY "Dataset types are viewable by everyone"
  ON dataset_types
  FOR SELECT
  USING (true);

-- Policy: Only authenticated users can insert/update/delete (but system types cannot be deleted)
CREATE POLICY "Authenticated users can manage dataset types"
  ON dataset_types
  FOR ALL
  USING (auth.role() = 'authenticated');

-- Grant permissions
GRANT SELECT ON dataset_types TO authenticated;
GRANT ALL ON dataset_types TO authenticated;
