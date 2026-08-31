import type { AgentMessage } from "../core/types";
import type { MemoryStore } from "../memory/store";
export interface SessionLearning {
    profileUpdates?: {
        businessType?: string;
        preferredCurrency?: string;
        timezone?: string;
        typicalVolume?: string;
        paymentMix?: string[];
        newPatterns?: string[];
        newConcerns?: string[];
        preferences?: Record<string, string>;
    };
    suggestedSkill?: {
        id: string;
        name: string;
        description: string;
        instructions: string;
        toolsets: string[];
        modes: string[];
    } | null;
}
export declare function learnFromSession(messages: AgentMessage[], merchantId: string, merchantName: string, apiKey: string, model: string, store: MemoryStore): Promise<SessionLearning>;
//# sourceMappingURL=session-learner.d.ts.map