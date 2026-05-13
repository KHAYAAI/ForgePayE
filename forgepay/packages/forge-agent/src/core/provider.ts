import Anthropic from "@anthropic-ai/sdk";

export interface ProviderConfig {
  apiKey:    string;
  model:     string;
  maxTokens: number;
  baseUrl?:  string;
}

// System block with optional cache_control (available in SDK >=0.27)
export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export interface StreamParams {
  system:   SystemBlock[];
  messages: Anthropic.MessageParam[];
  tools:    Anthropic.Tool[];
}

export interface LLMProvider {
  stream(params: StreamParams): ReturnType<Anthropic.Messages["stream"]>;
}

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });
  }

  stream(params: StreamParams): ReturnType<Anthropic.Messages["stream"]> {
    // Pass system blocks as-is; the SDK will use cache_control if present and supported.
    // Cast via unknown to satisfy TypeScript — the API accepts both string and block arrays.
    return this.client.messages.stream({
      model:      this.config.model,
      max_tokens: this.config.maxTokens,
      system:     params.system as unknown as string,
      tools:      params.tools,
      messages:   params.messages,
    });
  }
}

export function createProvider(config: ProviderConfig): LLMProvider {
  return new AnthropicProvider(config);
}
