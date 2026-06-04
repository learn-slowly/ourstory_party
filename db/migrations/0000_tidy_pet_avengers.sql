CREATE TABLE "candidates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"election_id" text NOT NULL,
	"constituency" text NOT NULL,
	"region_code" text,
	"party_id" text,
	"party_name_raw" text,
	"name" text NOT NULL,
	"votes" integer,
	"is_winner" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "elections" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"nec_election_id" text,
	"nec_code" text,
	"is_byelection" boolean DEFAULT false NOT NULL,
	"display_order" integer
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"family" text NOT NULL,
	"color" text NOT NULL,
	"satellite_of" text,
	"active_from" date,
	"active_until" date
);
--> statement-breakpoint
CREATE TABLE "party_aliases" (
	"alias" text NOT NULL,
	"party_id" text NOT NULL,
	"valid_from" date,
	"valid_until" date,
	CONSTRAINT "party_aliases_alias_valid_from_pk" PRIMARY KEY("alias","valid_from")
);
--> statement-breakpoint
CREATE TABLE "region_totals" (
	"election_id" text NOT NULL,
	"region_code" text NOT NULL,
	"total_voters" integer,
	"total_votes" integer,
	"valid_votes" integer,
	"invalid_votes" integer,
	"progress_pct" numeric(5, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "region_totals_election_id_region_code_pk" PRIMARY KEY("election_id","region_code")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"code" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"name" text NOT NULL,
	"parent_code" text,
	"display_order" integer
);
--> statement-breakpoint
CREATE TABLE "vote_totals" (
	"election_id" text NOT NULL,
	"region_code" text NOT NULL,
	"party_id" text NOT NULL,
	"votes" integer NOT NULL,
	"rank" integer,
	CONSTRAINT "vote_totals_election_id_region_code_party_id_pk" PRIMARY KEY("election_id","region_code","party_id")
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_satellite_of_parties_id_fk" FOREIGN KEY ("satellite_of") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_aliases" ADD CONSTRAINT "party_aliases_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_totals" ADD CONSTRAINT "region_totals_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "region_totals" ADD CONSTRAINT "region_totals_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_code_regions_code_fk" FOREIGN KEY ("parent_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_totals" ADD CONSTRAINT "vote_totals_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_totals" ADD CONSTRAINT "vote_totals_region_code_regions_code_fk" FOREIGN KEY ("region_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_totals" ADD CONSTRAINT "vote_totals_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cand_election_const_idx" ON "candidates" USING btree ("election_id","constituency");--> statement-breakpoint
CREATE INDEX "regions_parent_idx" ON "regions" USING btree ("parent_code");--> statement-breakpoint
CREATE INDEX "vt_region_idx" ON "vote_totals" USING btree ("region_code","election_id");--> statement-breakpoint
CREATE INDEX "vt_party_idx" ON "vote_totals" USING btree ("party_id","election_id");