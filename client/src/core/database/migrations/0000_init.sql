CREATE TABLE IF NOT EXISTS `cached_images` (
	`remoteKey` text PRIMARY KEY NOT NULL,
	`localPath` text NOT NULL,
	`fetchedAt` text NOT NULL,
	`byteSize` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `local_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`clientId` text,
	`userName` text NOT NULL,
	`userAvatar` text,
	`content` text NOT NULL,
	`category` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `local_posts_client_id_unique` ON `local_posts` (`clientId`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `local_posts_user_id_idx` ON `local_posts` (`userId`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pending_avatar_uploads` (
	`userId` text PRIMARY KEY NOT NULL,
	`localUri` text NOT NULL,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pending_post_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`postId` text NOT NULL,
	`action` text NOT NULL,
	`content` text,
	`category` text,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pending_readings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`clientId` text,
	`remoteId` integer,
	`syncStatus` text DEFAULT 'pending' NOT NULL,
	`systolic` real NOT NULL,
	`diastolic` real NOT NULL,
	`pulse` real NOT NULL,
	`measuredAt` text NOT NULL,
	`imageUri` text,
	`notes` text,
	`status` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pending_readings_client_id_unique` ON `pending_readings` (`clientId`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pending_readings_remote_id_unique` ON `pending_readings` (`remoteId`) WHERE "pending_readings"."remoteId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pending_readings_user_id_idx` ON `pending_readings` (`userId`);