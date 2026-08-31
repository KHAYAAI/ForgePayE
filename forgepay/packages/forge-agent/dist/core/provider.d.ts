import Anthropic from "@anthropic-ai/sdk";
export interface ProviderConfig {
    apiKey: string;
    model: string;
    maxTokens: number;
    baseUrl?: string;
}
export type SystemBlock = {
    type: "text";
    text: string;
    cache_control?: {
        type: "ephemeral";
    };
};
export interface StreamParams {
    system: SystemBlock[];
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
}
export interface LLMProvider {
    stream(params: StreamParams): ReturnType<Anthropic.Messages["stream"]>;
}
export declare class AnthropicProvider implements LLMProvider {
    private client;
    private config;
    constructor(config: ProviderConfig);
    stream(params: StreamParams): ReturnType<Anthropic.Messages["stream"]>;
}
export declare function createProvider(config: ProviderConfig): LLMProvider;
//# sourceMappingURL=provider.d.ts.map