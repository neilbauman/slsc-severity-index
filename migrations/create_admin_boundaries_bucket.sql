-- Create admin-boundaries storage bucket
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/zanbizkpowwinhkrlkgd/sql

-- Create the admin-boundaries bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'admin-boundaries',
  'admin-boundaries',
  false, -- Private bucket
  524288000, -- 500MB file size limit (increased for large GeoJSON/Shapefile uploads)
  ARRAY[
    'application/json',
    'application/geo+json',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'application/x-shapefile'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  file_size_limit = 524288000, -- Update limit if bucket exists
  allowed_mime_types = ARRAY[
    'application/json',
    'application/geo+json',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'application/x-shapefile'
  ];

-- Apply RLS policies for admin-boundaries bucket
-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Allow authenticated users to upload files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to read files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete files" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role to read files" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role to delete files" ON storage.objects;

-- Policy 1: Allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'admin-boundaries'
);

-- Policy 2: Allow authenticated users to read files
CREATE POLICY "Allow authenticated users to read files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'admin-boundaries'
);

-- Policy 3: Allow authenticated users to delete files
CREATE POLICY "Allow authenticated users to delete files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'admin-boundaries'
);

-- Policy 4: Allow service role to read files (for server-side processing)
CREATE POLICY "Allow service role to read files"
ON storage.objects
FOR SELECT
TO service_role
USING (
  bucket_id = 'admin-boundaries'
);

-- Policy 5: Allow service role to delete files (for cleanup)
CREATE POLICY "Allow service role to delete files"
ON storage.objects
FOR DELETE
TO service_role
USING (
  bucket_id = 'admin-boundaries'
);

