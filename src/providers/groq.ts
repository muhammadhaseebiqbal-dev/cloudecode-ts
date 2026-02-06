
import { BaseProvider } from './base';
import { Message, ToolDefinition, ChatResponse } from '../core/types';
import OpenAI from 'openai';

const DEFAULT_MODEL = 'qwen-2.5-coder-32b';

export class GroqProvider extends BaseProvider {
    client: OpenAI;

    constructor(apiKey?: string, model: string = DEFAULT_MODEL) {
        super(apiKey, model);
        if (!apiKey) throw new Error('Groq API Key required');
        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.groq.com/openai/v1',
        });
    }

    get name(): string {
        return 'Groq';
    }

    async validateConnection(): Promise<boolean> {
        try {
            // Use the models endpoint — it's lightweight and always works with a valid key
            const response = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Probe the API with a tiny request to discover the TPM limit from response headers.
     * Returns the x-ratelimit-limit-tokens value (TPM) for the given model.
     */
    static async probeRateLimit(apiKey: string, model: string): Promise<number | null> {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 1
                })
            });

            const tpmHeader = response.headers.get('x-ratelimit-limit-tokens');
            if (tpmHeader) {
                const tpm = parseInt(tpmHeader, 10);
                if (!isNaN(tpm) && tpm > 0) return tpm;
            }
            return null;
        } catch {
            return null;
        }
    }

    static async fetchModels(apiKey: string): Promise<any[]> {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/models', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            });
            const data: any = await response.json();
            
            if (!data?.data) return GroqProvider.fallbackModels();

            // Filter for only chat models if possible, but Groq mostly serves chat models
            return data.data.map((m: any) => ({
                id: m.id,
                contextWindow: m.context_window || 8192,
                name: m.id, 
                // Groq is fast, let's assume valid types
            })).sort((a: any, b: any) => a.id.localeCompare(b.id));

        } catch {
            return GroqProvider.fallbackModels();
        }
    }

    private static fallbackModels(): any[] {
        return [
            { id: 'qwen-2.5-coder-32b', contextWindow: 131072 },
            { id: 'llama-3.3-70b-versatile', contextWindow: 131072 },
            { id: 'llama-3.1-8b-instant', contextWindow: 131072 },
            { id: 'mixtral-8x7b-32768', contextWindow: 32768 },
            { id: 'gemma2-9b-it', contextWindow: 8192 }
        ];
    }

    async chat(message: string, onStream?: (chunk: string) => void): Promise<string> {
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
            throw new Error(error?.message || 'Groq chat error');
        }
    }

    async chatWithTools(messages: Message[], tools: ToolDefinition[], system?: string, signal?: AbortSignal): Promise<ChatResponse> {
        const openaiMessages: any[] = [];

        // Add system prompt first
        if (system) {
            openaiMessages.push({ role: 'system', content: system });
        }

        // Convert messages
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
                     // Groq requires tool_calls in OpenAI format with type: 'function'
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
            // Detect user-initiated abort
            if (error?.name === 'AbortError' || signal?.aborted) {
                return {
                    type: 'error',
                    content: 'Request cancelled by user.'
                };
            }
            return {
                type: 'error',
                content: error?.message || 'Unknown error during Groq API call'
            };
        }
    }
}
