import { query } from "@anthropic-ai/claude-agent-sdk";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { chats, memories } from "./db/schema.js";
import { schedulerMcpServer } from "./scheduler.js";
import { memoryMcpServer } from "./memory.js";

const SYSTEM_PROMPT = `Sei Tuna, un assistente personale intelligente e amichevole.
Rispondi sempre in italiano, in modo chiaro e conciso.
Hai accesso a strumenti per cercare sul web, eseguire comandi, leggere e scrivere file.
Usa questi strumenti quando necessario per fornire risposte accurate e utili.

## Memoria permanente
Le memorie sono le tue "skill" dinamiche: istruzioni, preferenze e conoscenze sull'utente
che guidano il tuo comportamento. Non sono hard-coded, evolvono nel tempo.
Esempi di memorie:
- "L'utente si chiama Matteo"
- "Quando l'utente chiede un riassunto, preferisce bullet points"
- "Rispondi sempre in modo informale"
- "Il progetto principale dell'utente si chiama TunaBot"

Quando impari qualcosa di nuovo sull'utente (nome, preferenze, come vuole che ti comporti),
salvalo proattivamente con save_memory. Le memorie sono fatti, preferenze e istruzioni permanenti.

Tools:
- save_memory: salva una nuova memoria
- update_memory: aggiorna una memoria esistente
- delete_memory: rimuove una memoria
- list_memories: elenca le memorie salvate

## Task schedulati
Per cose che devono accadere periodicamente (es. "ogni 5 minuti scrivimi ciao",
"ogni lunedì alle 9 mandami un riassunto"), usa SOLO schedule_task.
NON salvare task periodici nelle memorie — le memorie sono per conoscenze e istruzioni,
i task schedulati sono per azioni ricorrenti.

Tools:
- schedule_task: registra un task con espressione cron
- cancel_scheduled_task: cancella un task schedulato
- list_scheduled_tasks: elenca i task attivi`;

function buildSystemPromptWithMemories(
  chatId: bigint,
  memoriesList: string[]
): string {
  let prompt = `[chat_id: ${chatId.toString()}]\n\n${SYSTEM_PROMPT}`;

  if (memoriesList.length > 0) {
    prompt += `\n\nMemorie salvate su questo utente:\n${memoriesList.map((m) => `- ${m}`).join("\n")}`;
  }

  return prompt;
}

async function loadMemories(chatId: bigint): Promise<string[]> {
  const rows = await db
    .select({ content: memories.content })
    .from(memories)
    .where(eq(memories.chatId, chatId));
  return rows.map((r) => r.content);
}

async function getSessionId(chatId: bigint): Promise<string | null> {
  const row = await db
    .select({ sessionId: chats.sessionId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);
  return row[0]?.sessionId ?? null;
}

async function saveSessionId(
  chatId: bigint,
  sessionId: string
): Promise<void> {
  await db
    .update(chats)
    .set({ sessionId })
    .where(eq(chats.id, chatId));
}

export async function askAgent(
  prompt: string,
  chatId: bigint,
  timestamp?: Date
): Promise<string> {
  const { CLAUDECODE, ...cleanEnv } = process.env;

  const memoriesList = await loadMemories(chatId);
  const existingSessionId = await getSessionId(chatId);

  const isNewSession = !existingSessionId;
  const systemPrompt = buildSystemPromptWithMemories(chatId, memoriesList);

  const ts = timestamp ?? new Date();
  const fullPrompt = `[${ts.toLocaleString("it-IT", { timeZone: "Europe/Rome" })}] ${prompt}`;

  const options: Record<string, unknown> = {
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: 10,
    env: cleanEnv,
    mcpServers: {
      scheduler: schedulerMcpServer,
      memory: memoryMcpServer,
    },
  };

  if (isNewSession) {
    // New session: inject system prompt with memories
    options.systemPrompt = systemPrompt;
  } else {
    // Resume existing session
    options.resume = existingSessionId;
  }

  const q = query({ prompt: fullPrompt, options });

  let result = "";
  let sessionId = "";

  for await (const message of q) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        result = message.result;
        sessionId = message.session_id;
      } else {
        result =
          "Mi dispiace, si è verificato un errore durante l'elaborazione.";
      }
    }
  }

  // Save session ID for future resume
  if (sessionId && (isNewSession || sessionId !== existingSessionId)) {
    await saveSessionId(chatId, sessionId);
  }

  return result || "Nessuna risposta generata.";
}
