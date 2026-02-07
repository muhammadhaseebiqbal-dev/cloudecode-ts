
import { BaseProvider } from './base';
import { Message, ToolDefinition, ChatResponse } from '../core/types';

const DEFAULT_MODEL = 'qwen2.5-coder:32b';
const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider extends BaseProvider {
    baseUrl: string;

    constructor(apiKey?: string, model: string = DEFAULT_MODEL, baseUrl?: string) {
        // Ollama doesn't need an API key, but we accept it for interface consistency
        super(apiKey || 'ollama', model);
        this.baseUrl = baseUrl || DEFAULT_BASE_URL;
    }

    get name(): string {
        return 'Ollama';
    }

    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Ollama is local — no rate limits to probe.
     */
    static async probeRateLimit(_apiKey: string, _model: string): Promise<number | null> {
        return null;
    }

    static async fetchModels(_apiKey: string, baseUrl: string = DEFAULT_BASE_URL): Promise<any[]> {
        try {
            const response = await fetch(`${baseUrl}/api/tags`);
            const data: any = await response.json();

            if (!data?.models) return OllamaProvider.fallbackModels();

            return data.models
                .map((m: any) => ({
                    id: m.name || m.model,
                    name: m.name || m.model,
                    contextWindow: m.details?.parameter_size ? OllamaProvider.estimateContext(m) : 8192,
                    size: m.size,
                    modified: m.modified_at,
                }))
                .sort((a: any, b: any) => a.id.localeCompare(b.id));
        } catch {
            return OllamaProvider.fallbackModels();
        }
    }

    /** Estimate context window from model metadata */
    private static estimateContext(model: any): number {
        const name = (model.name || '').toLowerCase();
        // Common context sizes based on model families
        if (name.includes('qwen2.5')) return 131072;
        if (name.includes('llama3') || name.includes('llama-3')) return 131072;
        if (name.includes('gemma2')) return 8192;
        if (name.includes('mistral') || name.includes('mixtral')) return 32768;
        if (name.includes('deepseek')) return 65536;
        if (name.includes('phi')) return 16384;
        if (name.includes('codellama')) return 16384;
        return 8192;
    }

    private static fallbackModels(): any[] {
        return [
            { id: 'qwen2.5-coder:32b', contextWindow: 131072 },
            { id: 'qwen2.5-coder:7b', contextWindow: 131072 },
            { id: 'llama3.3:70b', contextWindow: 131072 },
            { id: 'llama3.1:8b', contextWindow: 131072 },
            { id: 'deepseek-coder-v2:16b', contextWindow: 65536 },
            { id: 'codellama:34b', contextWindow: 16384 },
        ];
    }

    async chat(message: string, _onStream?: (chunk: string) => void): Promise<string> {
        try {
            const msgs: any[] = [];
            if (this.systemPrompt) msgs.push({ role: 'system', content: this.systemPrompt });
            msgs.push({ role: 'user', content: message });

            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model || DEFAULT_MODEL,
                    messages: msgs,
                    stream: false,
                })
            });

            const data: any = await response.json();
            const content = data?.message?.content || '';
            this.addMessage('user', message);
            this.addMessage('assistant', content);
            return content;
        } catch (error: any) {
            throw new Error(error?.message || 'Ollama chat error');
        }
    }

    async chatWithTools(messages: Message[], tools: ToolDefinition[], system?: string, signal?: AbortSignal): Promise<ChatResponse> {
        const ollamaMessages: any[] = [];

        if (system) {
            ollamaMessages.push({ role: 'system', content: system });
        }

        for (const msg of messages) {
            if (msg.role === 'tool') {
                ollamaMessages.push({
                    role: 'tool',
                    content: msg.content
                });
            } else if (msg.role === 'assistant') {
                const content = msg.content || '';
                const parts: any = { role: 'assistant', content };
                if (msg.tool_calls) {
                    parts.tool_calls = msg.tool_calls.map(tc => ({
                        function: {
                            name: tc.name,
                            arguments: tc.arguments
                        }
                    }));
                }
                ollamaMessages.push(parts);
            } else {
                ollamaMessages.push({ role: msg.role, content: msg.content });
            }
        }

        try {
            const ollamaTools = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            }));

            const controller = new AbortController();
            if (signal) {
                signal.addEventListener('abort', () => controller.abort());
            }

            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model || DEFAULT_MODEL,
                    messages: ollamaMessages,
                    tools: ollamaTools,
                    stream: false,
                }),
                signal: controller.signal,
            });

            const data: any = await response.json();
            const message = data?.message;

            if (!message) {
                return { type: 'error', content: 'Empty response from Ollama' };
            }

            if (message.tool_calls && message.tool_calls.length > 0) {
                return {
                    type: 'tool_use',
                    content: message.content || '',
                    tool_calls: message.tool_calls.map((tc: any, i: number) => ({
                        id: `ollama_tc_${Date.now()}_${i}`,
                        name: tc.function.name,
                        arguments: typeof tc.function.arguments === 'string'
                            ? JSON.parse(tc.function.arguments)
                            : tc.function.arguments
                    }))
                };
            }

            return {
                type: 'text',
                content: message.content || ''
            };

        } catch (error: any) {
            if (error?.name === 'AbortError' || signal?.aborted) {
                return { type: 'error', content: 'Request cancelled by user.' };
            }
            return {
                type: 'error',
                content: error?.message || 'Unknown error during Ollama API call'
            };
        }
    }
}
