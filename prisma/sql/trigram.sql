-- Enable trigram extension (must be in the DB)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for fast fuzzy search
CREATE INDEX IF NOT EXISTS food_items_normalized_trgm
ON "FoodItem" USING gin ("normalized" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS food_items_name_trgm
ON "FoodItem" USING gin ("name" gin_trgm_ops);
