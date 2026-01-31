-- Trigram extension for similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes (IF NOT EXISTS makes it safe if they're already there)
CREATE INDEX IF NOT EXISTS food_items_normalized_trgm
ON "FoodItem" USING gin ("normalized" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS food_items_name_trgm
ON "FoodItem" USING gin ("name" gin_trgm_ops);
