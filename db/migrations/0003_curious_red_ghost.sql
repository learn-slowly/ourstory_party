DROP INDEX "ps_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "ps_uq" ON "polling_stations" USING btree ("election_id","sigungu_code","emd_code","name");