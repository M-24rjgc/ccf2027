CREATE TABLE `counters` (
	`key` text PRIMARY KEY NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `counters_expiry` ON `counters` (`expires_at`);--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`client` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leases_expiry` ON `leases` (`expires_at`);--> statement-breakpoint
CREATE INDEX `leases_client` ON `leases` (`client`);