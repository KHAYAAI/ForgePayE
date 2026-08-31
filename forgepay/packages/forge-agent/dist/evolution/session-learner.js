"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.learnFromSession = learnFromSession;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const merchant_profile_1 = require("../memory/merchant-profile");
const MIN_MESSAGES_TO_LEARN = 6;
const MAX_TRANSCRIPT_MESSAGES = 20;
const MAX_CONTENT_LENGTH = 400;
async function learnFromSession(messages, merchantId, merchantName, apiKey, model, store) {
    if (messages.length < MIN_MESSAGES_TO_LEARN)
        return {};
    const client = new sdk_1.default({ apiKey });
    const transcript = messages
        .slice(-MAX_TRANSCRIPT_MESSAGES)
        .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, MAX_CONTENT_LENGTH)}`)
        .join("\n---\n");
    const response = await client.messages.create({
        model,
        max_tokens: 512,
        system: `You are an AI system analyst. Analyze this conversation between a ForgePay billing agent and a merchant.
Extract structured learnings in JSON format with these exact keys:
{
  "profileUpdates": {
    "businessType": "SaaS|e-commerce|marketplace|services|other or null",
    "preferredCurrency": "ISO code or null",
    "timezone": "IANA timezone or null",
    "typicalVolume": "< $10k/mo | $10k-100k/mo | $100k-1M/mo | > $1M/mo or null",
    "paymentMix": ["card","usdc","crypto"] or null,
    "newPatterns": ["observed behavioral pattern"] or [],
    "newConcerns": ["recurring concern"] or [],
    "preferences": {"key": "value"} or {}
  },
  "suggestedSkill": {
    "id": "snake_case_id",
    "name": "Human readable name",
    "description": "One sentence",
    "instructions": "Specific instructions for this skill (2-5 sentences)",
    "toolsets": ["analytics","payments","subscriptions","crypto","billing"],
    "modes": ["insight","act"]
  } or null
}
Only suggest a skill if a clear, reusable domain expertise pattern emerged (not a one-off query).
Respond with ONLY valid JSON, no markdown.`,
        messages: [
            {
                role: "user",
                content: `Merchant: ${merchantName} (${merchantId})\n\nConversation:\n${transcript}`,
            },
        ],
    });
    const block = response.content[0];
    if (block.type !== "text")
        return {};
    try {
        const learning = JSON.parse(block.text);
        // Apply profile updates immediately
        if (learning.profileUpdates) {
            const { newPatterns, newConcerns, preferences, ...rest } = learning.profileUpdates;
            await (0, merchant_profile_1.updateMerchantProfile)({
                merchantId,
                merchantName,
                ...rest,
                learnedPatterns: newPatterns ?? [],
                concerns: newConcerns ?? [],
                preferences: preferences ?? {},
            }, store);
        }
        return learning;
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=session-learner.js.map