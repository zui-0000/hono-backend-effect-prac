ALTER TABLE "t_user" DROP CONSTRAINT "t_user_mail_address_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "t_user_mail_address_lower_unique" ON "t_user" USING btree (lower("mail_address"));