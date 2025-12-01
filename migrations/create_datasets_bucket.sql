-- Create datasets storage bucket
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/zanbizkpowwinhkrlkgd/sql

-- Create the datasets bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'datasets',
  'datasets',
  false, -- Private bucket
  52428800, -- 50MB file size limit
  ARRAY['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/json', 'application/geo+json']
)
ON CONFLICT (id) DO NOTHING;

-- Apply RLS policies for datasets bucket
-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Allow authenticated users to upload dataset files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to read dataset files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete dataset files" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role to read dataset files" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role to delete dataset files" ON storage.objects;

-- Policy 1: Allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload dataset files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'datasets'
);

-- Policy 2: Allow authenticated users to read files
CREATE POLICY "Allow authenticated users to read dataset files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'datasets'
);

-- Policy 3: Allow authenticated users to delete files
CREATE POLICY "Allow authenticated users to delete dataset files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'datasets'
);

-- Policy 4: Allow service role to read files (for server-side processing)
CREATE POLICY "Allow service role to read dataset files"
ON storage.objects
FOR SELECT
TO service_role
USING (
  bucket_id = 'datasets'
);

-- Policy 5: Allow service role to delete files (for cleanup)
CREATE POLICY "Allow service role to delete dataset files"
ON storage.objects
FOR DELETE
TO service_role
USING (
  bucket_id = 'datasets'
);

