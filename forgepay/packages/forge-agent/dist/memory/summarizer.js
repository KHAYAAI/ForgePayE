"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeSession = summarizeSession;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const MIN_MESSAGES_TO_SUMMARIZE = 4;
const MAX_CONTENT_LENGTH = 500;
async function summarizeSession(messages, merchantId, apiKey, model) {
    // Skip summarization if conversation is too short
    if (messages.length < MIN_MESSAGES_TO_SUMMARIZE)
        return "";
    const client = new sdk_1.default({ apiKey });
    const transcript = messages
        .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, MAX_CONTENT_LENGTH)}`)
        .join("\n");
    const response = await client.messages.create({
        model,
        max_tokens: 256,
        system: "You are a concise note-taker. Extract the key facts, preferences, and context from this conversation that would be useful to remember in future sessions. Output a single short paragraph (max 150 words). Focus on: merchant preferences, important metrics mentioned, decisions made, open questions.",
        messages: [
            {
                role: "user",
                content: `Conversation transcript:\n\n${transcript}`,
            },
        ],
    });
    const block = response.content[0];
    return block.type === "text" ? block.text : "";
}
//# sourceMappingURL=summarizer.js.map