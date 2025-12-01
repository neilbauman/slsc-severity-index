-- Fix infinite recursion in user_country_permissions RLS policies
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/zanbizkpowwinhkrlkgd/sql

-- First, let's see what policies exist and drop problematic ones
-- This will drop all existing policies on user_country_permissions to break the recursion

-- Drop all existing policies on user_country_permissions
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'user_country_permissions' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON user_country_permissions';
    END LOOP;
END $$;

-- Create simple, non-recursive policies for user_country_permissions
-- Policy 1: Users can view their own permissions
CREATE POLICY "Users can view own permissions"
ON user_country_permissions
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  -- No recursive checks - just direct user_id match
);

-- Policy 2: Users can view permissions for countries they have access to
-- But avoid recursion by not checking the permissions table itself
CREATE POLICY "Users can view accessible country permissions"
ON user_country_permissions
FOR SELECT
TO authenticated
USING (
  -- Only check if country is public or user created it
  EXISTS (
    SELECT 1 FROM countries
    WHERE countries.id = user_country_permissions.country_id
    AND (
      countries.is_public = true
      OR countries.created_by = auth.uid()
    )
  )
);

-- Policy 3: Service role can do everything (for admin operations)
CREATE POLICY "Service role full access"
ON user_country_permissions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

