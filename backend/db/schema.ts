import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const counters = sqliteTable("counters", {
  key: text("key").primaryKey(),
  used: integer("used").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("counters_expiry").on(table.expiresAt)]);

export const leases = sqliteTable("leases", {
  id: text("id").primaryKey(),
  client: text("client").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("leases_expiry").on(table.expiresAt), index("leases_client").on(table.client)]);

export const dailyUsage = sqliteTable("daily_usage", {
  day: integer("day").primaryKey(),
  questions: integer("questions").notNull().default(0),
  completed: integer("completed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  searchCalls: integer("search_calls").notNull().default(0),
  fetchCalls: integer("fetch_calls").notNull().default(0),
  legacyQuestions: integer("legacy_questions").notNull().default(0),
  legacyWeb: integer("legacy_web").notNull().default(0),
  legacyTokens: integer("legacy_tokens").notNull().default(0),
  startedAt: integer("started_at").notNull(),
});

export const modelUsage = sqliteTable("model_usage", {
  id: text("id").primaryKey(),
  day: integer("day").notNull(),
  reserved: integer("reserved").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  createdAt: integer("created_at").notNull(),
}, table => [index("model_usage_day").on(table.day)]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  version: integer("version").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});
