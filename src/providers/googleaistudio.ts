import { BaseProvider } from './base';
import { Message, ToolDefinition, ChatResponse } from '../core/types';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GENERATE_CONTENT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 120000;
const MAX_RETRY_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 750;
const MAX_RETRY_DELAY_MS = 8000;
const MIN_REQUEST_SPACING_MS = 400;

type GeminiFunctionCall = {
    id: string;
    name: string;
    args: Record<string, any>;
};

export class GoogleAIStudioProvider extends BaseProvider {
    private static requestQueue: Promise<void> = Promise.resolve();
    private static lastRequestStartedAt = 0;

    constructor(apiKey?: string, model: string = DEFAULT_MODEL) {
        super(apiKey, model);
        if (!apiKey) throw new Error('Google AI Studio API key required');
    }

    get name(): string {
        return 'Google AI Studio';
    }

    async validateConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${MODELS_ENDPOINT}?key=${this.apiKey}`, {
                method: 'GET',
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    static async probeRateLimit(_apiKey: string, _model: string): Promise<number | null> {
        // Google AI Studio doesn't expose a simple TPM header we can rely on.
        return null;
    }

    private static normalizeModelId(raw: string | undefined): string | null {
        if (!raw) return null;
        // API responses often use names like "models/gemini-1.5-flash-001"
        const parts = raw.split('/');
        return parts[parts.length - 1] || null;
    }

    private static getContextWindowFromModelMeta(m: any): number | null {
        // Common token limit fields (may differ across API versions)
        const input = m?.inputTokenLimit ?? m?.input_token_limit ?? m?.inputTokens;
        const output = m?.outputTokenLimit ?? m?.output_token_limit ?? m?.outputTokens;

        const pick = typeof input === 'number' && typeof output === 'number'
            ? Math.max(input, output)
            : (typeof input === 'number' ? input : (typeof output === 'number' ? output : null));

        if (pick && pick > 0) return pick;
        return null;
    }

    static async fetchModels(apiKey: string): Promise<any[]> {
        try {
            const response = await fetch(`${MODELS_ENDPOINT}?key=${apiKey}`, { method: 'GET' });
            if (!response.ok) return GoogleAIStudioProvider.fallbackModels();

            const data: any = await response.json();
            const rawModels: any[] =
                Array.isArray(data?.models) ? data.models :
                    Array.isArray(data) ? data :
                        [];

            const normalized = rawModels
                .map((m: any) => {
                    const rawId = m?.name || m?.model || m?.id;
                    const id = GoogleAIStudioProvider.normalizeModelId(rawId);
                    if (!id) return null;

                    return {
                        id,
                        contextWindow: GoogleAIStudioProvider.getContextWindowFromModelMeta(m) || undefined,
                    };
                })
                .filter(Boolean) as any[];

            // Gemma + Gemini only
            const filtered = normalized.filter(m =>
                (m.id as string).toLowerCase().includes('gemini') ||
                (m.id as string).toLowerCase().includes('gemma')
            );

            const withFallbackCtx = filtered.map(m => ({
                ...m,
                contextWindow: m.contextWindow ?? 8192,
            }));

            if (withFallbackCtx.length === 0) return GoogleAIStudioProvider.fallbackModels();
            return withFallbackCtx.sort((a: any, b: any) => a.id.localeCompare(b.id));
        } catch {
            return GoogleAIStudioProvider.fallbackModels();
        }
    }

    private static fallbackModels(): any[] {
        return [
            { id: 'gemini-2.0-flash-001', contextWindow: 1048576 },
            { id: 'gemini-1.5-pro', contextWindow: 1048576 },
            { id: 'gemini-1.5-flash', contextWindow: 1048576 },
            { id: 'gemini-pro-1.5', contextWindow: 1048576 },
            { id: 'gemma-2-27b-it', contextWindow: 8192 },
            { id: 'gemma-2-9b-it', contextWindow: 8192 },
            { id: 'gemma-2-2b-it', contextWindow: 8192 },
        ];
    }

    private extractText(resp: any): string {
        const parts = resp?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
            const texts = parts
                .map((p: any) => p?.text)
                .filter((t: any) => typeof t === 'string' && t.length > 0);
            return texts.join('').trim();
        }
        // Some versions may use a flattened field.
        return (resp?.text && typeof resp.text === 'string') ? resp.text.trim() : '';
    }

    private extractFunctionCalls(resp: any): GeminiFunctionCall[] {
        const calls: GeminiFunctionCall[] = [];

        const maybeTop = resp?.functionCalls;
        if (Array.isArray(maybeTop)) {
            for (const fc of maybeTop) {
                const normalized = this.normalizeFunctionCall(fc);
                if (normalized) calls.push(normalized);
            }
        }

        // REST often places function calls inside candidate parts.
        const candidateParts = resp?.candidates?.[0]?.content?.parts;
        if (Array.isArray(candidateParts)) {
            for (const part of candidateParts) {
                const fc = part?.functionCall ?? part?.function_call;
                if (!fc) continue;
                const normalized = this.normalizeFunctionCall(fc);
                if (normalized) calls.push(normalized);
            }
        }

        return calls;
    }

    private normalizeFunctionCall(fc: any): GeminiFunctionCall | null {
        const name = fc?.name ?? fc?.functionName ?? fc?.function_name;
        const id = fc?.id ?? fc?.functionCallId ?? fc?.function_call_id;
        const rawArgs = fc?.args ?? fc?.arguments ?? fc?.parameters;

        if (!name) return null;

        let args: Record<string, any> = {};
        if (typeof rawArgs === 'string') {
            try {
                args = JSON.parse(rawArgs);
            } catch {
                args = { raw: rawArgs };
            }
        } else if (rawArgs && typeof rawArgs === 'object') {
            args = rawArgs as Record<string, any>;
        }

        return {
            id: id || `gemini_fc_${Date.now()}`,
            name,
            args,
        };
    }

    private abortError(): Error {
        const error = new Error('Request cancelled by user.');
        error.name = 'AbortError';
        return error;
    }

    private throwIfAborted(signal?: AbortSignal) {
        if (signal?.aborted) throw this.abortError();
    }

    private sleep(ms: number, signal?: AbortSignal): Promise<void> {
        if (ms <= 0) return Promise.resolve();

        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(this.abortError());
                return;
            }

            const timeout = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, ms);

            const onAbort = () => {
                clearTimeout(timeout);
                reject(this.abortError());
            };

            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    private parseRetryAfterMs(response: any): number | null {
        const retryAfter = response.headers?.get?.('retry-after');
        if (!retryAfter) return null;

        const seconds = Number(retryAfter);
        if (!Number.isNaN(seconds)) {
            return Math.max(0, seconds * 1000);
        }

        const date = Date.parse(retryAfter);
        if (!Number.isNaN(date)) {
            return Math.max(0, date - Date.now());
        }

        return null;
    }

    private isRetryableStatus(status: number): boolean {
        return status === 408 || status === 409 || status === 429 || status >= 500;
    }

    private retryDelayMs(attempt: number, response?: any): number {
        const retryAfter = response ? this.parseRetryAfterMs(response) : null;
        if (retryAfter !== null) return Math.min(retryAfter, MAX_RETRY_DELAY_MS);

        const exponential = Math.min(
            MAX_RETRY_DELAY_MS,
            BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
        );
        const jitter = Math.floor(Math.random() * 250);
        return exponential + jitter;
    }

    private createRequestSignal(parent?: AbortSignal): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
        const controller = new AbortController();
        let didTimeout = false;
        const timeout = setTimeout(() => {
            didTimeout = true;
            controller.abort();
        }, REQUEST_TIMEOUT_MS);

        const onAbort = () => controller.abort();
        parent?.addEventListener('abort', onAbort, { once: true });

        return {
            signal: controller.signal,
            cleanup: () => {
                clearTimeout(timeout);
                parent?.removeEventListener('abort', onAbort);
            },
            timedOut: () => didTimeout,
        };
    }

    private async waitForRequestSlot(signal?: AbortSignal): Promise<void> {
        this.throwIfAborted(signal);

        const elapsed = Date.now() - GoogleAIStudioProvider.lastRequestStartedAt;
        const waitMs = Math.max(0, MIN_REQUEST_SPACING_MS - elapsed);
        await this.sleep(waitMs, signal);

        GoogleAIStudioProvider.lastRequestStartedAt = Date.now();
    }

    private async runQueued<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const previous = GoogleAIStudioProvider.requestQueue;
        let release!: () => void;
        GoogleAIStudioProvider.requestQueue = new Promise(resolve => {
            release = resolve;
        });

        await previous.catch(() => undefined);

        try {
            await this.waitForRequestSlot(signal);
            return await operation();
        } finally {
            release();
        }
    }

    private formatErrorMessage(status: number, bodyText: string, attempts: number): string {
        const suffix = attempts > 1 ? ` after ${attempts} attempts` : '';
        return `Google AI Studio request failed${suffix}: ${status} ${bodyText}`.trim();
    }

    private buildContentsFromHistory(messages: Message[]): any[] {
        const contents: any[] = [];
        const toolNameById = new Map<string, string>();

        for (const msg of messages) {
            if (msg.role === 'assistant' && msg.tool_calls?.length) {
                for (const tc of msg.tool_calls) {
                    if (tc.id && tc.name) {
                        toolNameById.set(tc.id, tc.name);
                    }
                }
            }

            if (msg.role === 'tool') {
                // Tool output becomes a functionResponse part back to the model.
                const id = msg.tool_call_id || '';
                const name = msg.tool_name || (id ? toolNameById.get(id) || '' : '');

                // Google requires functionResponse.name; skip malformed legacy tool messages.
                if (!name) {
                    continue;
                }

                contents.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name,
                            id,
                            response: {
                                // App tools return text; wrap it consistently.
                                result: msg.content
                            }
                        }
                    }]
                });
                continue;
            }

            if (msg.role === 'assistant') {
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    const functionCallParts = msg.tool_calls.map(tc => ({
                        functionCall: {
                            name: tc.name,
                            id: tc.id,
                            args: tc.arguments
                        }
                    }));

                    const parts: any[] = [];
                    if (msg.content) parts.push({ text: msg.content });
                    parts.push(...functionCallParts);

                    contents.push({ role: 'model', parts });
                } else {
                    contents.push({
                        role: 'model',
                        parts: [{ text: msg.content || '' }]
                    });
                }
                continue;
            }

            // user + system: both become user messages for this API call.
            contents.push({
                role: 'user',
                parts: [{ text: msg.content || '' }]
            });
        }

        return contents;
    }

    private async generateContent(
        contents: any[],
        system?: string,
        tools?: ToolDefinition[],
        signal?: AbortSignal
    ): Promise<any> {
        const functionDeclarations = tools?.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        })) ?? [];

        const body: any = {
            contents,
        };

        if (system) {
            body.systemInstruction = {
                role: 'system',
                parts: [{ text: system }],
            };
        }

        if (tools && tools.length > 0) {
            body.tools = [{ functionDeclarations }];
            body.toolConfig = {
                functionCallingConfig: {
                    mode: 'AUTO',
                },
            };
        }

        return this.runQueued(async () => {
            let lastStatus = 0;
            let lastBody = '';

            for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
                this.throwIfAborted(signal);

                const request = this.createRequestSignal(signal);
                try {
                    const response = await fetch(`${GENERATE_CONTENT_BASE}/${this.model}:generateContent`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-goog-api-key': this.apiKey || '',
                        },
                        body: JSON.stringify(body),
                        signal: request.signal,
                    });

                    if (response.ok) {
                        return response.json();
                    }

                    lastStatus = response.status;
                    lastBody = await response.text().catch(() => '');

                    if (!this.isRetryableStatus(response.status) || attempt === MAX_RETRY_ATTEMPTS) {
                        const error = new Error(this.formatErrorMessage(response.status, lastBody, attempt + 1));
                        (error as any).nonRetryable = true;
                        throw error;
                    }

                    await this.sleep(this.retryDelayMs(attempt, response), signal);
                } catch (error: any) {
                    if (signal?.aborted) {
                        throw this.abortError();
                    }

                    if (error?.nonRetryable) {
                        throw error;
                    }

                    if (attempt === MAX_RETRY_ATTEMPTS) {
                        const message = request.timedOut()
                            ? `Google AI Studio request timed out after ${attempt + 1} attempts`
                            : lastStatus
                            ? this.formatErrorMessage(lastStatus, lastBody, attempt + 1)
                            : `Google AI Studio request failed after ${attempt + 1} attempts: ${error?.message || error}`;
                        throw new Error(message);
                    }

                    await this.sleep(this.retryDelayMs(attempt), signal);
                } finally {
                    request.cleanup();
                }
            }

            throw new Error('Google AI Studio request failed: exhausted retry attempts');
        }, signal);
    }

    async chat(message: string, _onStream?: (chunk: string) => void): Promise<string> {
        const contents = [{ role: 'user', parts: [{ text: message }] }];
        try {
            const data = await this.generateContent(contents, this.systemPrompt, undefined);
            const content = this.extractText(data) || '';
            this.addMessage('user', message);
            this.addMessage('assistant', content);
            return content;
        } catch (e: any) {
            throw new Error(e?.message || 'Google AI Studio chat error');
        }
    }

    async chatWithTools(
        messages: Message[],
        tools: ToolDefinition[],
        system?: string,
        signal?: AbortSignal
    ): Promise<ChatResponse> {
        const contents = this.buildContentsFromHistory(messages);

        try {
            const data = await this.generateContent(contents, system, tools, signal);
            const text = this.extractText(data);
            const functionCalls = this.extractFunctionCalls(data);

            if (functionCalls.length > 0) {
                return {
                    type: 'tool_use',
                    content: text || '',
                    tool_calls: functionCalls.map((fc, idx) => ({
                        id: fc.id || `gemini_tool_${Date.now()}_${idx}`,
                        name: fc.name,
                        arguments: fc.args || {},
                    })),
                };
            }

            return {
                type: 'text',
                content: text || '',
            };
        } catch (error: any) {
            if (error?.name === 'AbortError' || signal?.aborted) {
                return { type: 'error', content: 'Request cancelled by user.' };
            }
            return {
                type: 'error',
                content: error?.message || 'Unknown error during Google AI Studio API call',
            };
        }
    }
}
