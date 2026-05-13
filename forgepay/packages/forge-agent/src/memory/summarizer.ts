import Anthropic from "@anthropic-ai/sdk";
import type { AgentMessage } from "../core/types";

const MIN_MESSAGES_TO_SUMMARIZE = 4;
const MAX_CONTENT_LENGTH = 500;

export async function summarizeSession(
  messages: AgentMessage[],
  merchantId: string,
  apiKey: string,
  model: string
): Promise<string> {
  // Skip summarization if conversation is too short
  if (messages.length < MIN_MESSAGES_TO_SUMMARIZE) return "";

  const client = new Anthropic({ apiKey });

  const transcript = messages
    .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, MAX_CONTENT_LENGTH)}`)
    .join("\n");

  const response = await client.messages.create({
    model,
    max_tokens: 256,
    system:
      "You are a concise note-taker. Extract the key facts, preferences, and context from this conversation that would be useful to remember in future sessions. Output a single short paragraph (max 150 words). Focus on: merchant preferences, important metrics mentioned, decisions made, open questions.",
    messages: [
      {
        role:    "user",
        content: `Conversation transcript:\n\n${transcript}`,
      },
    ],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}
