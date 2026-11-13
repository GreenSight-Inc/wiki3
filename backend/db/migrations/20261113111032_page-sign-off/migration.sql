CREATE TABLE "pageSignOffApprovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"pageId" uuid NOT NULL,
	"userId" uuid,
	"groupId" uuid,
	CONSTRAINT "pageSignOffApprovers_approver_check" CHECK (num_nonnulls("userId", "groupId") = 1)
);
--> statement-breakpoint
CREATE TABLE "pageSignOffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"pageId" uuid NOT NULL,
	"versionId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"verdict" varchar(24) NOT NULL,
	"comment" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "signOffMode" varchar(16) DEFAULT 'off' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pageSignOffApprovers_page_user_idx" ON "pageSignOffApprovers" ("pageId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX "pageSignOffApprovers_page_group_idx" ON "pageSignOffApprovers" ("pageId","groupId");--> statement-breakpoint
CREATE INDEX "pageSignOffApprovers_userId_idx" ON "pageSignOffApprovers" ("userId");--> statement-breakpoint
CREATE INDEX "pageSignOffApprovers_groupId_idx" ON "pageSignOffApprovers" ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX "pageSignOffs_version_user_idx" ON "pageSignOffs" ("versionId","userId");--> statement-breakpoint
CREATE INDEX "pageSignOffs_page_version_idx" ON "pageSignOffs" ("pageId","versionId");--> statement-breakpoint
ALTER TABLE "pageSignOffApprovers" ADD CONSTRAINT "pageSignOffApprovers_pageId_pages_id_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pageSignOffApprovers" ADD CONSTRAINT "pageSignOffApprovers_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pageSignOffApprovers" ADD CONSTRAINT "pageSignOffApprovers_groupId_groups_id_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pageSignOffs" ADD CONSTRAINT "pageSignOffs_pageId_pages_id_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pageSignOffs" ADD CONSTRAINT "pageSignOffs_userId_users_id_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;