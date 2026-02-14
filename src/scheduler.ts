import { z } from "zod";
import {
  tool,
  createSdkMcpServer,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { CronExpressionParser } from "cron-parser";
import { lte, eq, and } from "drizzle-orm";
import { db } from "./db/index.js";
import { scheduledTasks } from "./db/schema.js";
import type { Bot } from "grammy";

const SCHEDULER_INTERVAL_MS = 5_000;
const TELEGRAM_MAX_LENGTH = 4096;

// Concurrency lock: one agent call per chat at a time
const busyChats = new Set<bigint>();

function nextCronDate(cronExpression: string): Date {
  const expr = CronExpressionParser.parse(cronExpression);
  return expr.next().toDate();
}

// MCP tools
const scheduleTaskTool = tool(
  "schedule_task",
  `Registra un task schedulato con un'espressione cron.
Esempi di cron:
- "* * * * *" = ogni minuto
- "*/5 * * * *" = ogni 5 minuti
- "0 9 * * *" = ogni giorno alle 9:00
- "0 9 * * 1" = ogni lunedì alle 9:00
- "0 */2 * * *" = ogni 2 ore
- "30 8 1 * *" = il primo del mese alle 8:30`,
  {
    instruction: z
      .string()
      .describe("L'istruzione da eseguire periodicamente"),
    cron_expression: z
      .string()
      .describe("Espressione cron (es. '*/5 * * * *' per ogni 5 minuti)"),
    chat_id: z
      .string()
      .describe("L'ID della chat Telegram (fornito nel prompt)"),
  },
  async (args) => {
    try {
      const nextRun = nextCronDate(args.cron_expression);
      const chatId = BigInt(args.chat_id);

      await db.insert(scheduledTasks).values({
        chatId,
        instruction: args.instruction,
        cronExpression: args.cron_expression,
        nextRunAt: nextRun,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Task schedulato! Cron: "${args.cron_expression}". Prossima esecuzione: ${nextRun.toLocaleString("it-IT")}.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Errore: espressione cron non valida "${args.cron_expression}".`,
          },
        ],
        isError: true,
      };
    }
  }
);

const cancelTaskTool = tool(
  "cancel_scheduled_task",
  "Cancella un task schedulato esistente per ID.",
  {
    task_id: z.number().describe("L'ID del task da cancellare"),
  },
  async (args) => {
    await db
      .update(scheduledTasks)
      .set({ active: false })
      .where(eq(scheduledTasks.id, args.task_id));

    return {
      content: [
        { type: "text" as const, text: `Task #${args.task_id} cancellato.` },
      ],
    };
  }
);

const listTasksTool = tool(
  "list_scheduled_tasks",
  "Elenca tutti i task schedulati attivi per una chat.",
  {
    chat_id: z.string().describe("L'ID della chat Telegram"),
  },
  async (args) => {
    const chatId = BigInt(args.chat_id);
    const tasks = await db
      .select()
      .from(scheduledTasks)
      .where(
        and(eq(scheduledTasks.chatId, chatId), eq(scheduledTasks.active, true))
      );

    const text = tasks.length
      ? tasks
          .map(
            (t) =>
              `#${t.id}: "${t.instruction}" cron="${t.cronExpression}" (prossimo: ${t.nextRunAt.toLocaleString("it-IT")})`
          )
          .join("\n")
      : "Nessun task schedulato attivo.";

    return {
      content: [{ type: "text" as const, text }],
    };
  }
);

export const schedulerMcpServer = createSdkMcpServer({
  name: "scheduler",
  tools: [scheduleTaskTool, cancelTaskTool, listTasksTool],
});

// Scheduler loop
export function startScheduler(bot: Bot) {
  setInterval(async () => {
    try {
      const dueTasks = await db
        .select()
        .from(scheduledTasks)
        .where(
          and(
            lte(scheduledTasks.nextRunAt, new Date()),
            eq(scheduledTasks.active, true)
          )
        );

      for (const task of dueTasks) {
        if (busyChats.has(task.chatId)) continue;

        busyChats.add(task.chatId);
        executeScheduledTask(bot, task).finally(() => {
          busyChats.delete(task.chatId);
        });
      }
    } catch (err) {
      console.error("Scheduler error:", err);
    }
  }, SCHEDULER_INTERVAL_MS);

  console.log(
    `Scheduler started (checking every ${SCHEDULER_INTERVAL_MS / 1000}s)`
  );
}

async function executeScheduledTask(
  bot: Bot,
  task: typeof scheduledTasks.$inferSelect
) {
  try {
    const { CLAUDECODE, ...cleanEnv } = process.env;

    const q = query({
      prompt: task.instruction,
      options: {
        systemPrompt:
          "Sei Tuna, un assistente personale. Rispondi in italiano, in modo conciso. Stai eseguendo un task schedulato.",
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 5,
        env: cleanEnv as Record<string, string>,
      },
    });

    let result = "";
    for await (const message of q) {
      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
      }
    }

    if (result) {
      const chatId = Number(task.chatId);
      if (result.length <= TELEGRAM_MAX_LENGTH) {
        await bot.api.sendMessage(chatId, result);
      } else {
        for (let i = 0; i < result.length; i += TELEGRAM_MAX_LENGTH) {
          await bot.api.sendMessage(
            chatId,
            result.slice(i, i + TELEGRAM_MAX_LENGTH)
          );
        }
      }
    }

    // Calculate next run from cron and update
    const nextRun = nextCronDate(task.cronExpression);
    await db
      .update(scheduledTasks)
      .set({ nextRunAt: nextRun })
      .where(eq(scheduledTasks.id, task.id));
  } catch (err) {
    console.error(`Scheduled task #${task.id} failed:`, err);
  }
}
