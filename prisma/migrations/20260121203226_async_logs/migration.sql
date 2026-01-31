-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('ready', 'pending', 'error');

-- DropForeignKey
ALTER TABLE "FoodLog" DROP CONSTRAINT "FoodLog_food_item_id_fkey";

-- DropIndex
DROP INDEX "food_items_name_trgm";

-- DropIndex
DROP INDEX "food_items_normalized_trgm";

-- AlterTable
ALTER TABLE "FoodLog" ADD COLUMN     "error_msg" TEXT,
ADD COLUMN     "status" "LogStatus" NOT NULL DEFAULT 'pending',
ALTER COLUMN "food_item_id" DROP NOT NULL,
ALTER COLUMN "kcal" DROP NOT NULL,
ALTER COLUMN "protein_g" DROP NOT NULL,
ALTER COLUMN "carbs_g" DROP NOT NULL,
ALTER COLUMN "fat_g" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "FoodLog_status_idx" ON "FoodLog"("status");

-- AddForeignKey
ALTER TABLE "FoodLog" ADD CONSTRAINT "FoodLog_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "FoodItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
