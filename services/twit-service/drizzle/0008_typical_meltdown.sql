CREATE TABLE "home_feed" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "home_feed_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"follower_id" integer NOT NULL,
	"twit_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "home_feed_follower_created_at_id_idx" ON "home_feed" USING btree ("follower_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);