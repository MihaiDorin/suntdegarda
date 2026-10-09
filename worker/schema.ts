import { db } from "@/lib/server";

const statements: string[] = [
  "CREATE TABLE IF NOT EXISTS `audit` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`action` text NOT NULL,\n\t`created` text NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS `holidays` (\n\t`date` text PRIMARY KEY NOT NULL,\n\t`label` text NOT NULL,\n\t`enabled` integer DEFAULT 1 NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS `limits` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`count` integer NOT NULL,\n\t`expires` integer NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS `months` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`status` text DEFAULT 'locked' NOT NULL,\n\t`deadline` text,\n\t`version` integer DEFAULT 0 NOT NULL,\n\t`mutation` text,\n\t`report` text DEFAULT '{}' NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS `notifications` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`message` text NOT NULL,\n\t`read` integer DEFAULT 0 NOT NULL,\n\t`created` text NOT NULL,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action\n);",
  "CREATE INDEX IF NOT EXISTS `notifications_user` ON `notifications` (`user_id`);",
  "CREATE TABLE IF NOT EXISTS `resets` (\n\t`token` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`expires` integer NOT NULL,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action\n);",
  "CREATE TABLE IF NOT EXISTS `sessions` (\n\t`token` text PRIMARY KEY NOT NULL,\n\t`user_id` text NOT NULL,\n\t`expires` integer NOT NULL,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action\n);",
  "CREATE INDEX IF NOT EXISTS `sessions_user` ON `sessions` (`user_id`);",
  "CREATE TABLE IF NOT EXISTS `settings` (\n\t`key` text PRIMARY KEY NOT NULL,\n\t`value` text NOT NULL\n);",
  "CREATE TABLE IF NOT EXISTS `shifts` (\n\t`date` text PRIMARY KEY NOT NULL,\n\t`month` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`points` integer NOT NULL,\n\t`reason` text NOT NULL,\n\t`completed` integer DEFAULT 0 NOT NULL,\n\tFOREIGN KEY (`month`) REFERENCES `months`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action\n);",
  "CREATE INDEX IF NOT EXISTS `shifts_month` ON `shifts` (`month`);",
  "CREATE INDEX IF NOT EXISTS `shifts_user` ON `shifts` (`user_id`);",
  "CREATE TABLE IF NOT EXISTS `submissions` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`month` text NOT NULL,\n\t`user_id` text NOT NULL,\n\t`preferred` text NOT NULL,\n\t`available` text NOT NULL,\n\t`updated` text NOT NULL,\n\tFOREIGN KEY (`month`) REFERENCES `months`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action\n);",
  "CREATE INDEX IF NOT EXISTS `submissions_month` ON `submissions` (`month`);",
  "CREATE TABLE IF NOT EXISTS `swaps` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`from_date` text NOT NULL,\n\t`to_date` text NOT NULL,\n\t`requester` text NOT NULL,\n\t`recipient` text NOT NULL,\n\t`status` text DEFAULT 'pending' NOT NULL,\n\t`created` text NOT NULL,\n\tFOREIGN KEY (`requester`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,\n\tFOREIGN KEY (`recipient`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action\n);",
  "CREATE INDEX IF NOT EXISTS `swaps_requester` ON `swaps` (`requester`);",
  "CREATE INDEX IF NOT EXISTS `swaps_recipient` ON `swaps` (`recipient`);",
  "CREATE TABLE IF NOT EXISTS `users` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`email` text NOT NULL,\n\t`name` text NOT NULL,\n\t`password` text NOT NULL,\n\t`role` text DEFAULT 'doctor' NOT NULL,\n\t`active` integer DEFAULT 0 NOT NULL,\n\t`base_points` integer DEFAULT 0 NOT NULL,\n\t`created` text NOT NULL\n);",
  "CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);"
];

let ready: Promise<void> | undefined;

export function ensureSchema(): Promise<void> {
  ready ??= db().batch(statements.map(sql => db().prepare(sql)))
    .then(() => undefined)
    .catch(error => { ready = undefined; throw error; });
  return ready;
}
