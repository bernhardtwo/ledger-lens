ALTER TABLE "transactions" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_model" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "categorized_at" timestamp with time zone;