-- RLS Policies for datasets table
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/zanbizkpowwinhkrlkgd/sql

-- Enable RLS on datasets table if not already enabled
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Users can view datasets" ON datasets;
DROP POLICY IF EXISTS "Users can insert datasets" ON datasets;
DROP POLICY IF EXISTS "Users can update their own datasets" ON datasets;
DROP POLICY IF EXISTS "Public can view public country datasets" ON datasets;

-- Policy 1: Allow authenticated users to view all datasets
CREATE POLICY "Users can view datasets"
ON datasets
FOR SELECT
TO authenticated
USING (true);

-- Policy 2: Allow authenticated users to insert datasets
-- (Note: We use service role for inserts via API, but this allows direct inserts too)
CREATE POLICY "Users can insert datasets"
ON datasets
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy 3: Allow authenticated users to update datasets they uploaded
CREATE POLICY "Users can update their own datasets"
ON datasets
FOR UPDATE
TO authenticated
USING (uploaded_by = auth.uid())
WITH CHECK (uploaded_by = auth.uid());

-- Policy 4: Allow public to view datasets for public countries
CREATE POLICY "Public can view public country datasets"
ON datasets
FOR SELECT
TO anon
USING (
  EXISTS (
    SELECT 1 FROM countries
    WHERE countries.id = datasets.country_id
    AND countries.is_public = true
  )
);

