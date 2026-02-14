import { Bot } from "grammy";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { chats, messages } from "./db/schema.js";
import { askAgent } from "./agent.js";
import { transcribeAudio } from "./transcribe.js";

const TELEGRAM_MAX_LENGTH = 4096;

function markdownToTelegramHtml(text: string): string {
  return (
    text
      // Code blocks: ```lang\ncode\n``` → <pre><code>code</code></pre>
      .replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`)
      // Inline code: `code` → <code>code</code>
      .replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`)
      // Bold: **text** → <b>text</b>
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      // Italic: *text* → <i>text</i>
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>")
      // Strikethrough: ~~text~~ → <s>text</s>
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      // Links: [text](url) → <a href="url">text</a>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const bot = new Bot(config.telegramBotToken);

bot.catch((err) => {
  console.error("Bot error:", err.message);
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Ciao! Sono Tuna, il tuo assistente personale AI. Scrivimi qualsiasi cosa e ti aiuterò!"
  );
});

async function handleMessage(
  chatId: bigint,
  userText: string,
  messageDate: Date,
  reply: (text: string) => Promise<unknown>
) {
  await db
    .insert(chats)
    .values({ id: chatId })
    .onConflictDoNothing();

  const response = await askAgent(userText, chatId, messageDate);

  await db.insert(messages).values([
    { chatId, role: "user" as const, content: userText },
    { chatId, role: "assistant" as const, content: response },
  ]);

  const html = markdownToTelegramHtml(response);

  if (html.length <= TELEGRAM_MAX_LENGTH) {
    await reply(html);
  } else {
    for (let i = 0; i < html.length; i += TELEGRAM_MAX_LENGTH) {
      await reply(html.slice(i, i + TELEGRAM_MAX_LENGTH));
    }
  }
}

bot.on("message:text", async (ctx) => {
  const chatId = BigInt(ctx.chat.id);
  const messageDate = new Date(ctx.message.date * 1000);
  await handleMessage(chatId, ctx.message.text, messageDate, (t) =>
    ctx.reply(t, { parse_mode: "HTML" })
  );
});

bot.on("message:voice", async (ctx) => {
  const chatId = BigInt(ctx.chat.id);
  const messageDate = new Date(ctx.message.date * 1000);

  const file = await ctx.getFile();
  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());

  const transcript = await transcribeAudio(buffer);

  if (!transcript) {
    await ctx.reply("Non sono riuscito a capire il vocale, puoi ripetere?");
    return;
  }

  await handleMessage(chatId, transcript, messageDate, (t) =>
    ctx.reply(t, { parse_mode: "HTML" })
  );
});
