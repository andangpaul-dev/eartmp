-- Workflow handoff notifications: address each notification to a ROLE + record
-- who triggered it. Additive; existing (none) rows default to an empty role.
ALTER TABLE "Notification" ADD COLUMN "recipientRole" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Notification" ADD COLUMN "actorUserId" TEXT;
CREATE INDEX "Notification_recipientRole_isRead_idx" ON "Notification"("recipientRole", "isRead");
