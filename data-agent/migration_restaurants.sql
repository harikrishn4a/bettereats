-- Create restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cuisine TEXT,
  rating FLOAT DEFAULT 0,
  delivery_time TEXT,
  grab_url TEXT UNIQUE NOT NULL,
  district TEXT NOT NULL,
  health_score FLOAT DEFAULT 0,
  latitude FLOAT,
  longitude FLOAT,
  scraped_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_restaurants_district ON restaurants(district);
CREATE INDEX IF NOT EXISTS idx_restaurants_health_score ON restaurants(health_score DESC);
CREATE INDEX IF NOT EXISTS idx_restaurants_rating ON restaurants(rating DESC);
CREATE INDEX IF NOT EXISTS idx_restaurants_grab_url ON restaurants(grab_url);

-- Create menu_items table for Phase 2
CREATE TABLE IF NOT EXISTS menu_items (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price FLOAT,
  dietary_tags TEXT[] DEFAULT '{}',
  health_score FLOAT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(restaurant_id, name)
);

-- Create index on restaurant_id for faster queries
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_id ON menu_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_health_score ON menu_items(health_score DESC);

-- Enable RLS (Row Level Security) for public access
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (no auth required)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurants' AND policyname = 'Allow public read on restaurants'
  ) THEN
    CREATE POLICY "Allow public read on restaurants"
      ON restaurants FOR SELECT
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'menu_items' AND policyname = 'Allow public read on menu_items'
  ) THEN
    CREATE POLICY "Allow public read on menu_items"
      ON menu_items FOR SELECT
      USING (true);
  END IF;
END $$;

-- Expose tables to Data API
GRANT SELECT ON restaurants TO anon, authenticated;
GRANT SELECT ON menu_items TO anon, authenticated;
