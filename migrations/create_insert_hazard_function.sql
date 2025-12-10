-- Create function to insert hazards with PostGIS geometry conversion
-- This function converts GeoJSON to PostGIS geography type

CREATE OR REPLACE FUNCTION insert_hazard(
  p_country_id UUID,
  p_name TEXT,
  p_type TEXT,
  p_date DATE,
  p_geometry_json TEXT,
  p_affected_areas JSONB,
  p_metadata JSONB,
  p_uploaded_by UUID
)
RETURNS TABLE (
  id UUID,
  country_id UUID,
  name TEXT,
  type TEXT,
  date DATE,
  geometry GEOGRAPHY,
  affected_areas JSONB,
  metadata JSONB,
  uploaded_by UUID,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  v_geometry GEOGRAPHY;
BEGIN
  -- Convert GeoJSON to PostGIS geography
  IF p_geometry_json IS NOT NULL AND p_geometry_json != '' THEN
    BEGIN
      v_geometry := ST_SetSRID(ST_GeomFromGeoJSON(p_geometry_json), 4326)::geography;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Failed to convert GeoJSON to geometry: %', SQLERRM;
    END;
  ELSE
    v_geometry := NULL;
  END IF;

  -- Insert the hazard
  RETURN QUERY
  INSERT INTO hazards (
    country_id,
    name,
    type,
    date,
    geometry,
    affected_areas,
    metadata,
    uploaded_by
  ) VALUES (
    p_country_id,
    p_name,
    p_type,
    p_date,
    v_geometry,
    p_affected_areas,
    p_metadata,
    p_uploaded_by
  )
  RETURNING
    hazards.id,
    hazards.country_id,
    hazards.name,
    hazards.type,
    hazards.date,
    hazards.geometry,
    hazards.affected_areas,
    hazards.metadata,
    hazards.uploaded_by,
    hazards.created_at;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION insert_hazard TO authenticated;

-- Add comment
COMMENT ON FUNCTION insert_hazard IS 'Inserts a hazard record with PostGIS geometry conversion from GeoJSON';

