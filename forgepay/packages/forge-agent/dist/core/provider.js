"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicProvider = void 0;
exports.createProvider = createProvider;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class AnthropicProvider {
    constructor(config) {
        this.config = config;
        this.client = new sdk_1.default({
            apiKey: config.apiKey,
            ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        });
    }
    stream(params) {
        // Pass system blocks as-is; the SDK will use cache_control if present and supported.
        // Cast via unknown to satisfy TypeScript — the API accepts both string and block arrays.
        return this.client.messages.stream({
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            system: params.system,
            tools: params.tools,
            messages: params.messages,
        });
    }
}
exports.AnthropicProvider = AnthropicProvider;
function createProvider(config) {
    return new AnthropicProvider(config);
}
//# sourceMappingURL=provider.js.map