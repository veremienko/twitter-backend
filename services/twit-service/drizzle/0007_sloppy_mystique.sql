DROP INDEX "twits_created_at_id_idx";--> statement-breakpoint
CREATE INDEX "twits_created_at_id_idx" ON "twits" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);