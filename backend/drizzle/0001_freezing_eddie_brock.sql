CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`day` integer PRIMARY KEY NOT NULL,
	`questions` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`search_calls` integer DEFAULT 0 NOT NULL,
	`fetch_calls` integer DEFAULT 0 NOT NULL,
	`legacy_questions` integer DEFAULT 0 NOT NULL,
	`legacy_web` integer DEFAULT 0 NOT NULL,
	`legacy_tokens` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`day` integer NOT NULL,
	`reserved` integer NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_usage_day` ON `model_usage` (`day`);