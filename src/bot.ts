import { Bot } from "grammy";
import { eq, desc } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { chats, messages } from "./db/schema.js";
import { askAgent } from "./agent.js";

const MAX_HISTORY = 20;
const TELEGRAM_MAX_LENGTH = 4096;

export const bot = new Bot(config.telegramBotToken);

bot.catch((err) => {
  console.error("Bot error:", err.message);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Ciao! Sono Tuna, il tuo assistente personale AI. Scrivimi qualsiasi cosa e ti aiuterò!"
  );
});

bot.on("message:text", async (ctx) => {
  const chatId = BigInt(ctx.chat.id);
  const userText = ctx.message.text;

  // Ensure chat exists
  await db
    .insert(chats)
    .values({ id: chatId })
    .onConflictDoNothing();

  // Load conversation history
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY);

  history.reverse();

  // Call agent
  const response = await askAgent(
    userText,
    chatId,
    history as { role: "user" | "assistant"; content: string }[]
  );

  // Save both messages
  await db.insert(messages).values([
    { chatId, role: "user" as const, content: userText },
    { chatId, role: "assistant" as const, content: response },
  ]);

  // Send response, splitting if too long
  if (response.length <= TELEGRAM_MAX_LENGTH) {
    await ctx.reply(response);
  } else {
    for (let i = 0; i < response.length; i += TELEGRAM_MAX_LENGTH) {
      await ctx.reply(response.slice(i, i + TELEGRAM_MAX_LENGTH));
    }
  }
});
