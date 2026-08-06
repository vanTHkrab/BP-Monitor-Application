CREATE TABLE `pending_readings` (
	`client_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`systolic` real NOT NULL,
	`diastolic` real NOT NULL,
	`pulse` real NOT NULL,
	`measured_at` text NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`image_uri` text,
	`image_id` integer,
	`recorded_by_id` text,
	`recorded_by_name` text,
	`created_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `pending_readings_user_idx` ON `pending_readings` (`user_id`);--> statement-breakpoint
CREATE TABLE `readings` (
	`remote_id` integer PRIMARY KEY NOT NULL,
	`client_id` text,
	`user_id` text NOT NULL,
	`systolic` real NOT NULL,
	`diastolic` real NOT NULL,
	`pulse` real NOT NULL,
	`measured_at` text NOT NULL,
	`status` text NOT NULL,
	`notes` text,
	`image_uri` text,
	`image_id` integer,
	`recorded_by_id` text,
	`recorded_by_name` text,
	`created_at` text NOT NULL,
	`updated_at` text,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `readings_user_measured_idx` ON `readings` (`user_id`,`measured_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `readings_client_id_unique` ON `readings` (`client_id`);