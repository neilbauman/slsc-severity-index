-- Storage RLS Policies for admin-boundaries bucket
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/zanbizkpowwinhkrlkgd/sql

-- Policy 1: Allow authenticated users to upload files
CREATE POLICY "Allow authenticated users to upload files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'admin-boundaries'
);

-- Policy 2: Allow authenticated users to read their own files
CREATE POLICY "Allow authenticated users to read files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'admin-boundaries'
);

-- Policy 3: Allow authenticated users to delete their own files
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

-- ============================================
-- Storage RLS Policies for datasets bucket
-- ============================================

-- Policy 6: Allow authenticated users to upload files to datasets bucket
CREATE POLICY "Allow authenticated users to upload dataset files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'datasets'
);

-- Policy 7: Allow authenticated users to read dataset files
CREATE POLICY "Allow authenticated users to read dataset files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'datasets'
);

-- Policy 8: Allow authenticated users to delete dataset files
CREATE POLICY "Allow authenticated users to delete dataset files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'datasets'
);

-- Policy 9: Allow service role to read dataset files (for server-side processing)
CREATE POLICY "Allow service role to read dataset files"
ON storage.objects
FOR SELECT
TO service_role
USING (
  bucket_id = 'datasets'
);

-- Policy 10: Allow service role to delete dataset files (for cleanup)
CREATE POLICY "Allow service role to delete dataset files"
ON storage.objects
FOR DELETE
TO service_role
USING (
  bucket_id = 'datasets'
);

