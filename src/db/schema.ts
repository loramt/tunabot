import {
  pgTable,
  bigint,
  serial,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const chats = pgTable("chats", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    chatId: bigint("chat_id", { mode: "bigint" })
      .notNull()
      .references(() => chats.id),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("messages_chat_created_idx").on(table.chatId, table.createdAt)]
);

export const memories = pgTable("memories", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "bigint" })
    .notNull()
    .references(() => chats.id),
  content: text("content").notNull(),
  category: text("category"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "bigint" })
    .notNull()
    .references(() => chats.id),
  instruction: text("instruction").notNull(),
  cronExpression: text("cron_expression").notNull(),
  nextRunAt: timestamp("next_run_at").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
