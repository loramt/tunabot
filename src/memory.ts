import { z } from "zod";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { eq, and } from "drizzle-orm";
import { db } from "./db/index.js";
import { memories } from "./db/schema.js";

const saveMemoryTool = tool(
  "save_memory",
  "Salva un fatto o preferenza dell'utente nella memoria permanente. Usa frasi brevi e fattuali (es. 'L'utente si chiama Matteo', 'Preferisce risposte in italiano').",
  {
    content: z
      .string()
      .describe("Il fatto da memorizzare, breve e fattuale"),
    category: z
      .string()
      .optional()
      .describe("Categoria opzionale (es. 'personale', 'preferenze', 'lavoro')"),
    chat_id: z
      .string()
      .describe("L'ID della chat Telegram (fornito nel system prompt)"),
  },
  async (args) => {
    const chatId = BigInt(args.chat_id);

    await db.insert(memories).values({
      chatId,
      content: args.content,
      category: args.category ?? null,
    });

    return {
      content: [
        { type: "text" as const, text: `Memorizzato: "${args.content}"` },
      ],
    };
  }
);

const listMemoriesTool = tool(
  "list_memories",
  "Elenca tutte le memorie salvate per questa chat.",
  {
    chat_id: z.string().describe("L'ID della chat Telegram"),
  },
  async (args) => {
    const chatId = BigInt(args.chat_id);
    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.chatId, chatId));

    const text = rows.length
      ? rows
          .map(
            (m) =>
              `#${m.id}: "${m.content}"${m.category ? ` [${m.category}]` : ""}`
          )
          .join("\n")
      : "Nessuna memoria salvata.";

    return {
      content: [{ type: "text" as const, text }],
    };
  }
);

const deleteMemoryTool = tool(
  "delete_memory",
  "Rimuove una memoria per ID.",
  {
    memory_id: z.number().describe("L'ID della memoria da rimuovere"),
  },
  async (args) => {
    await db.delete(memories).where(eq(memories.id, args.memory_id));

    return {
      content: [
        {
          type: "text" as const,
          text: `Memoria #${args.memory_id} rimossa.`,
        },
      ],
    };
  }
);

const updateMemoryTool = tool(
  "update_memory",
  "Aggiorna il contenuto di una memoria esistente per ID.",
  {
    memory_id: z.number().describe("L'ID della memoria da aggiornare"),
    content: z.string().describe("Il nuovo contenuto della memoria"),
  },
  async (args) => {
    await db
      .update(memories)
      .set({ content: args.content, updatedAt: new Date() })
      .where(eq(memories.id, args.memory_id));

    return {
      content: [
        {
          type: "text" as const,
          text: `Memoria #${args.memory_id} aggiornata: "${args.content}"`,
        },
      ],
    };
  }
);

export const memoryMcpServer = createSdkMcpServer({
  name: "memory",
  tools: [saveMemoryTool, listMemoriesTool, deleteMemoryTool, updateMemoryTool],
});
