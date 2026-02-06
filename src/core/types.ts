
export interface Message {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    tool_name?: string;
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
}

export interface ProviderConfig {
    name: string;
    apiKey?: string;
    model?: string;
    contextWindow?: number;
    tpmLimit?: number;
    enabled?: boolean;
}

export interface ConfigType {
    provider: string;
    providers: Record<string, ProviderConfig>;
    theme: string;
    maxTokens: number;
}

export interface ChatResponse {
    type: 'text' | 'tool_use' | 'error';
    content?: string;
    tool_calls?: ToolCall[];
}
