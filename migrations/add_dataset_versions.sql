-- Create dataset_versions table for tracking dataset snapshots
CREATE TABLE IF NOT EXISTS dataset_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  metadata JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(dataset_id, version_number)
);

-- Create dataset_cleaning_history table to track cleaning operations
CREATE TABLE IF NOT EXISTS dataset_cleaning_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version_before UUID REFERENCES dataset_versions(id),
  version_after UUID REFERENCES dataset_versions(id),
  action_type TEXT NOT NULL, -- 'clean', 'revert', 'manual_edit'
  action_details JSONB, -- Details about what was cleaned
  affected_rows INTEGER,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_dataset_versions_dataset_id ON dataset_versions(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dataset_versions_created_at ON dataset_versions(created_at);
CREATE INDEX IF NOT EXISTS idx_cleaning_history_dataset_id ON dataset_cleaning_history(dataset_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_history_created_at ON dataset_cleaning_history(created_at);

-- Add RLS policies
ALTER TABLE dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_cleaning_history ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read versions
CREATE POLICY "Users can view dataset versions"
  ON dataset_versions FOR SELECT
  USING (true);

-- Allow authenticated users to create versions
CREATE POLICY "Users can create dataset versions"
  ON dataset_versions FOR INSERT
  WITH CHECK (true);

-- Allow authenticated users to read cleaning history
CREATE POLICY "Users can view cleaning history"
  ON dataset_cleaning_history FOR SELECT
  USING (true);

-- Allow authenticated users to create cleaning history
CREATE POLICY "Users can create cleaning history"
  ON dataset_cleaning_history FOR INSERT
  WITH CHECK (true);

