CREATE TABLE "polling_station_totals" (
	"station_id" bigint PRIMARY KEY NOT NULL,
	"total_voters" integer,
	"total_votes" integer,
	"valid_votes" integer,
	"invalid_votes" integer
);
--> statement-breakpoint
CREATE TABLE "polling_station_votes" (
	"station_id" bigint NOT NULL,
	"party_id" text,
	"raw_name" text NOT NULL,
	"votes" integer NOT NULL,
	CONSTRAINT "polling_station_votes_station_id_raw_name_pk" PRIMARY KEY("station_id","raw_name")
);
--> statement-breakpoint
CREATE TABLE "polling_stations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"election_id" text NOT NULL,
	"sigungu_code" text NOT NULL,
	"emd_code" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"nec_town_code" text
);
--> statement-breakpoint
ALTER TABLE "polling_station_totals" ADD CONSTRAINT "polling_station_totals_station_id_polling_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."polling_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_station_votes" ADD CONSTRAINT "polling_station_votes_station_id_polling_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."polling_stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_station_votes" ADD CONSTRAINT "polling_station_votes_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_sigungu_code_regions_code_fk" FOREIGN KEY ("sigungu_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polling_stations" ADD CONSTRAINT "polling_stations_emd_code_regions_code_fk" FOREIGN KEY ("emd_code") REFERENCES "public"."regions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "psv_party_idx" ON "polling_station_votes" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ps_uq" ON "polling_stations" USING btree ("election_id","sigungu_code","name");--> statement-breakpoint
CREATE INDEX "ps_emd_idx" ON "polling_stations" USING btree ("election_id","emd_code");