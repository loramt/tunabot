import { query } from "@anthropic-ai/claude-agent-sdk";
import { schedulerMcpServer } from "./scheduler.js";

const SYSTEM_PROMPT = `Sei Tuna, un assistente personale intelligente e amichevole.
Rispondi sempre in italiano, in modo chiaro e conciso.
Hai accesso a strumenti per cercare sul web, eseguire comandi, leggere e scrivere file.
Usa questi strumenti quando necessario per fornire risposte accurate e utili.

Hai anche accesso a tool per schedulare task periodici:
- schedule_task: per registrare un'istruzione con espressione cron
- cancel_scheduled_task: per cancellare un task schedulato
- list_scheduled_tasks: per vedere i task attivi

Quando l'utente chiede di fare qualcosa periodicamente (es. "ogni 5 minuti scrivimi ciao",
"ogni lunedì alle 9 mandami un riassunto"), converti la richiesta in un'espressione cron
e usa il tool schedule_task passando il chat_id fornito nel prompt.`;

export async function askAgent(
  prompt: string,
  chatId: bigint,
  conversationHistory: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const historyText = conversationHistory
    .map((m) => `${m.role === "user" ? "Utente" : "Assistente"}: ${m.content}`)
    .join("\n");

  const contextPrefix = `[chat_id: ${chatId.toString()}]\n`;
  const fullPrompt = historyText
    ? `${contextPrefix}Conversazione precedente:\n${historyText}\n\nUtente: ${prompt}`
    : `${contextPrefix}${prompt}`;

  // Remove CLAUDECODE env var to avoid nested session detection
  const { CLAUDECODE, ...cleanEnv } = process.env;

  const q = query({
    prompt: fullPrompt,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      env: cleanEnv as Record<string, string>,
      mcpServers: { scheduler: schedulerMcpServer },
    },
  });

  let result = "";

  for await (const message of q) {
    if (message.type === "result") {
      if (message.subtype === "success") {
        result = message.result;
      } else {
        result = "Mi dispiace, si è verificato un errore durante l'elaborazione.";
      }
    }
  }

  return result || "Nessuna risposta generata.";
}
