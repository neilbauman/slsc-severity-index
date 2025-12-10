-- Create function to get hazard geometry as GeoJSON
-- This helps with retrieving PostGIS geometry in a usable format

CREATE OR REPLACE FUNCTION get_hazard_geometry_geojson(p_hazard_id UUID)
RETURNS JSON AS $$
DECLARE
  v_geometry GEOGRAPHY;
  v_geojson JSON;
BEGIN
  -- Get geometry from hazards table
  SELECT geometry INTO v_geometry
  FROM hazards
  WHERE id = p_hazard_id;

  IF v_geometry IS NULL THEN
    RETURN NULL;
  END IF;

  -- Convert geography to GeoJSON
  -- Note: ST_AsGeoJSON returns text, we need to parse it
  SELECT ST_AsGeoJSON(v_geometry::geometry)::json INTO v_geojson;

  RETURN v_geojson;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_hazard_geometry_geojson TO authenticated;

COMMENT ON FUNCTION get_hazard_geometry_geojson IS 'Returns hazard geometry as GeoJSON for use in spatial analysis';

