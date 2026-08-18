CREATE TABLE "follows" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "follows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"follower_id" integer NOT NULL,
	"followee_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_unique" UNIQUE("follower_id","followee_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "follower_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "following_count" integer DEFAULT 0 NOT NULL;