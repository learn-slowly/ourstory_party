CREATE TABLE "election_party_overrides" (
	"election_id" text NOT NULL,
	"raw_name" text NOT NULL,
	"party_id" text NOT NULL,
	"note" text,
	CONSTRAINT "election_party_overrides_election_id_raw_name_pk" PRIMARY KEY("election_id","raw_name")
);
--> statement-breakpoint
ALTER TABLE "election_party_overrides" ADD CONSTRAINT "election_party_overrides_election_id_elections_id_fk" FOREIGN KEY ("election_id") REFERENCES "public"."elections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "election_party_overrides" ADD CONSTRAINT "election_party_overrides_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;