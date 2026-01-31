-- CreateTable
CREATE TABLE "FoodItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "kcal" DECIMAL(65,30) NOT NULL,
    "protein_g" DECIMAL(65,30) NOT NULL,
    "carbs_g" DECIMAL(65,30) NOT NULL,
    "fat_g" DECIMAL(65,30) NOT NULL,
    "fiber_g" DECIMAL(65,30),
    "source" TEXT NOT NULL,
    "confidence" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoodItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoodLog" (
    "id" TEXT NOT NULL,
    "food_item_id" TEXT NOT NULL,
    "raw_text" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meal" TEXT,
    "kcal" DECIMAL(65,30) NOT NULL,
    "protein_g" DECIMAL(65,30) NOT NULL,
    "carbs_g" DECIMAL(65,30) NOT NULL,
    "fat_g" DECIMAL(65,30) NOT NULL,
    "fiber_g" DECIMAL(65,30),

    CONSTRAINT "FoodLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodItem_normalized_key" ON "FoodItem"("normalized");

-- CreateIndex
CREATE INDEX "FoodLog_logged_at_idx" ON "FoodLog"("logged_at" DESC);

-- CreateIndex
CREATE INDEX "FoodLog_food_item_id_idx" ON "FoodLog"("food_item_id");

-- AddForeignKey
ALTER TABLE "FoodLog" ADD CONSTRAINT "FoodLog_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "FoodItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
