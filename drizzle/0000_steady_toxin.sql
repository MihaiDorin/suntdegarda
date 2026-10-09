CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holidays` (
	`date` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `months` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`deadline` text,
	`version` integer DEFAULT 0 NOT NULL,
	`mutation` text,
	`report` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE TABLE `resets` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`date` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`user_id` text NOT NULL,
	`points` integer NOT NULL,
	`reason` text NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`month`) REFERENCES `months`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shifts_month` ON `shifts` (`month`);--> statement-breakpoint
CREATE INDEX `shifts_user` ON `shifts` (`user_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`user_id` text NOT NULL,
	`preferred` text NOT NULL,
	`available` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`month`) REFERENCES `months`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `submissions_month` ON `submissions` (`month`);--> statement-breakpoint
CREATE TABLE `swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`requester` text NOT NULL,
	`recipient` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created` text NOT NULL,
	FOREIGN KEY (`requester`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `swaps_requester` ON `swaps` (`requester`);--> statement-breakpoint
CREATE INDEX `swaps_recipient` ON `swaps` (`recipient`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password` text NOT NULL,
	`role` text DEFAULT 'doctor' NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`base_points` integer DEFAULT 0 NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);