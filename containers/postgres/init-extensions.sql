-- Extensions Rezervio depends on. The PostGIS image already creates postgis in
-- template databases, but stating all three here keeps the contract explicit
-- and makes the init reproducible on any fresh volume.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
