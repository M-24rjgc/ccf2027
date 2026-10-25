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
