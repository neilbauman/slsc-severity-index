-- Create function to calculate area impact of a hazard on admin boundaries
-- Returns the percentage of each admin area covered by the hazard

CREATE OR REPLACE FUNCTION calculate_hazard_area_impact(
  p_hazard_id UUID,
  p_admin_level INTEGER DEFAULT NULL
)
RETURNS TABLE (
  admin_boundary_id UUID,
  admin_name TEXT,
  pcode TEXT,
  admin_level INTEGER,
  total_area_km2 NUMERIC,
  affected_area_km2 NUMERIC,
  affected_percentage NUMERIC
) AS $$
DECLARE
  v_hazard_geom GEOGRAPHY;
BEGIN
  -- Get the hazard geometry (use the main geometry column)
  SELECT geometry INTO v_hazard_geom
  FROM hazards
  WHERE id = p_hazard_id;

  IF v_hazard_geom IS NULL THEN
    RAISE EXCEPTION 'Hazard with id % not found or has no geometry', p_hazard_id;
  END IF;

  -- Calculate intersection for each admin boundary
  RETURN QUERY
  SELECT 
    ab.id as admin_boundary_id,
    ab.name as admin_name,
    ab.pcode,
    ab.level as admin_level,
    ROUND((ST_Area(ab.geometry::geography) / 1000000)::numeric, 2) as total_area_km2,
    CASE 
      WHEN ST_Intersects(ab.geometry, v_hazard_geom) THEN
        ROUND((ST_Area(ST_Intersection(ab.geometry, v_hazard_geom)::geography) / 1000000)::numeric, 2)
      ELSE 0
    END as affected_area_km2,
    CASE 
      WHEN ST_Area(ab.geometry::geography) > 0 THEN
        ROUND(((ST_Area(ST_Intersection(ab.geometry, v_hazard_geom)::geography) / 
                ST_Area(ab.geometry::geography)) * 100)::numeric, 2)
      ELSE 0
    END as affected_percentage
  FROM admin_boundaries ab
  WHERE ab.country_id = (SELECT country_id FROM hazards WHERE id = p_hazard_id)
    AND (p_admin_level IS NULL OR ab.level = p_admin_level)
    AND ST_Intersects(ab.geometry, v_hazard_geom)
  ORDER BY affected_percentage DESC, ab.name;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION calculate_hazard_area_impact(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_hazard_area_impact(UUID, INTEGER) TO service_role;

-- Add comment
COMMENT ON FUNCTION calculate_hazard_area_impact IS 'Calculates the percentage of each admin boundary area affected by a hazard using PostGIS spatial intersection';

