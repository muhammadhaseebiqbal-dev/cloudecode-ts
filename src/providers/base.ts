
import { Message, ToolDefinition, ChatResponse } from '../core/types';

export abstract class BaseProvider {
    apiKey?: string;
    model?: string;
    conversationHistory: Message[] = [];
    systemPrompt?: string;

    constructor(apiKey?: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model;
    }

    abstract get name(): string;

    abstract validateConnection(): Promise<boolean>;

    abstract chat(
        message: string,
        onStream?: (chunk: string) => void
    ): Promise<string>;

    abstract chatWithTools(
        messages: Message[],
        tools: ToolDefinition[],
        system?: string
    ): Promise<ChatResponse>;

    // Dynamic model fetching — override in subclass
    static async fetchModels(apiKey: string): Promise<any[]> {
        return [];
    }

    // Model categorization — override in subclass
    static categorizeModels(models: any[]): { fast: any[]; allRounder: any[]; context: any[] } {
        return { fast: [], allRounder: [], context: [] };
    }

    setSystemPrompt(prompt: string) {
        this.systemPrompt = prompt;
    }

    addMessage(role: Message['role'], content: string, extra?: Partial<Message>) {
        this.conversationHistory.push({ role, content, ...extra });
    }

    clearHistory() {
        this.conversationHistory = [];
    }
}
