CREATE TABLE "twits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "twits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"author_id" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
