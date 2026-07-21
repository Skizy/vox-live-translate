import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable(
    "users",
    {
        id: text("id").primaryKey(),
        email: text("email").notNull(),
        name: text("name").notNull(),
        picture: text("picture"),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable(
    "sessions",
    {
        tokenHash: text("token_hash").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
        index("sessions_expires_at_index").on(table.expiresAt),
        index("sessions_user_id_index").on(table.userId),
    ],
);

export const issuedEphemeralTokens = pgTable(
    "issued_ephemeral_tokens",
    {
        token: text("token").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        targetLanguageCode: text("target_language_code").notNull(),
        issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (table) => [index("issued_ephemeral_tokens_user_id_index").on(table.userId)],
);
