ALTER TABLE "company_vehicles" ADD COLUMN "manufactureYear" INTEGER;
ALTER TABLE "company_vehicles" ADD CONSTRAINT "company_vehicle_manufacture_year_min" CHECK ("manufactureYear" IS NULL OR "manufactureYear" >= 1300);
