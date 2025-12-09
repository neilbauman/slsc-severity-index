-- Alter the geometry column to accept both Polygon and MultiPolygon
-- The original type was geography(Polygon,4326) which only accepts Polygon
-- Changed to geography(Geometry,4326) to accept Polygon, MultiPolygon, and other geometry types

ALTER TABLE admin_boundaries
ALTER COLUMN geometry TYPE geography(Geometry,4326) 
USING geometry::geometry::geography;
