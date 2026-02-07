
import { BaseProvider } from './base';
import { Message, ToolDefinition, ChatResponse } from '../core/types';
import OpenAI from 'openai';

const DEFAULT_MODEL = 'anthropic/claude-3.5-sonnet';

export class OpenRouterProvider extends BaseProvider {
    client: OpenAI;

    constructor(apiKey?: string, model: string = DEFAULT_MODEL) {
        super(apiKey, model);
        if (!apiKey) throw new Error('OpenRouter API Key required');
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://cloudecode.dev',
                'X-Title': 'Cloudé Code',
            },
        });
    }

    get name(): string {
        return 'OpenRouter';
    }

    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * OpenRouter doesn't expose TPM via headers the same way Groq does.
     * Return null — the system will use a safe default.
     */
    static async probeRateLimit(_apiKey: string, _model: string): Promise<number | null> {
        return null;
    }

    static async fetchModels(apiKey: string): Promise<any[]> {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            const data: any = await response.json();

            if (!data?.data) return OpenRouterProvider.fallbackModels();

            // Filter to models that support tool use / chat, sort by name
            return data.data
                .filter((m: any) => m.id && !m.id.includes('instruct'))
                .map((m: any) => ({
                    id: m.id,
                    name: m.name || m.id,
                    contextWindow: m.context_length || 8192,
                    pricing: m.pricing,
                }))
                .sort((a: any, b: any) => a.id.localeCompare(b.id));
        } catch {
            return OpenRouterProvider.fallbackModels();
        }
    }

    private static fallbackModels(): any[] {
        return [
            { id: 'anthropic/claude-3.5-sonnet', contextWindow: 200000 },
            { id: 'anthropic/claude-3-haiku', contextWindow: 200000 },
            { id: 'google/gemini-2.0-flash-001', contextWindow: 1048576 },
            { id: 'google/gemini-pro-1.5', contextWindow: 1048576 },
            { id: 'meta-llama/llama-3.3-70b-instruct', contextWindow: 131072 },
            { id: 'openai/gpt-4o', contextWindow: 128000 },
            { id: 'openai/gpt-4o-mini', contextWindow: 128000 },
            { id: 'deepseek/deepseek-chat', contextWindow: 65536 },
            { id: 'qwen/qwen-2.5-coder-32b-instruct', contextWindow: 131072 },
        ];
    }

    async chat(message: string, _onStream?: (chunk: string) => void): Promise<string> {
        try {
            const msgs: any[] = [];
            if (this.systemPrompt) msgs.push({ role: 'system', content: this.systemPrompt });
            msgs.push({ role: 'user', content: message });

            const response = await this.client.chat.completions.create({
                model: this.model || DEFAULT_MODEL,
                messages: msgs,
            });

            const content = response.choices[0]?.message?.content || '';
            this.addMessage('user', message);
            this.addMessage('assistant', content);
            return content;
        } catch (error: any) {
            throw new Error(error?.message || 'OpenRouter chat error');
        }
    }

    async chatWithTools(messages: Message[], tools: ToolDefinition[], system?: string, signal?: AbortSignal): Promise<ChatResponse> {
        const openaiMessages: any[] = [];

        if (system) {
            openaiMessages.push({ role: 'system', content: system });
        }

        for (const msg of messages) {
            if (msg.role === 'tool') {
                openaiMessages.push({
                    role: 'tool',
                    tool_call_id: msg.tool_call_id,
                    content: msg.content
                });
            } else if (msg.role === 'assistant') {
                const content = msg.content || null;
                const parts: any = { role: 'assistant', content };
                if (msg.tool_calls) {
                    parts.tool_calls = msg.tool_calls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments)
                        }
                    }));
                }
                openaiMessages.push(parts);
            } else {
                openaiMessages.push({ role: msg.role, content: msg.content });
            }
        }

        try {
            const toolsConfig = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }
            }));

            const response = await this.client.chat.completions.create({
                model: this.model || DEFAULT_MODEL,
                messages: openaiMessages as any,
                tools: toolsConfig as any,
                tool_choice: 'auto'
            }, signal ? { signal } : undefined);

            const choice = response.choices[0];
            const message = choice.message;

            if (message.tool_calls) {
                return {
                    type: 'tool_use',
                    content: message.content || '',
                    tool_calls: message.tool_calls.map(tc => ({
                        id: tc.id,
                        name: tc.function.name,
                        arguments: JSON.parse(tc.function.arguments)
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
                content: error?.message || 'Unknown error during OpenRouter API call'
            };
        }
    }
}
