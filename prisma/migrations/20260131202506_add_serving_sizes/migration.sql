-- AlterTable
ALTER TABLE "FoodLog" ADD COLUMN     "serving_grams" DECIMAL(65,30),
ADD COLUMN     "serving_unit" TEXT;

-- CreateTable
CREATE TABLE "ServingSize" (
    "id" TEXT NOT NULL,
    "food_item_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grams" DECIMAL(65,30) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServingSize_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServingSize_food_item_id_idx" ON "ServingSize"("food_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "ServingSize_food_item_id_name_key" ON "ServingSize"("food_item_id", "name");

-- AddForeignKey
ALTER TABLE "ServingSize" ADD CONSTRAINT "ServingSize_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "FoodItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
