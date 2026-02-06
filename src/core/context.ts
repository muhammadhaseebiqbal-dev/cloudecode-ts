
/**
 * Lightweight token estimator.
 * Uses ~4 chars per token heuristic (good enough for context tracking).
 * No external dependency needed.
 */

import { Message } from './types';

// Approximate tokens from a string (~4 chars = 1 token)
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

// Estimate total tokens for a message array
export function estimateMessageTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
        total += estimateTokens(msg.content);
        // Each message has ~4 tokens overhead (role, formatting)
        total += 4;
        if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                total += estimateTokens(tc.name);
                total += estimateTokens(JSON.stringify(tc.arguments));
                total += 4;
            }
        }
    }
    return total;
}

import { config } from './config';

/**
 * Get the effective context window for a model.
 * This is the MINIMUM of:
 *   - The model's max context window (from API/config)
 *   - The user's TPM (tokens per minute) rate limit
 * Because the entire request must fit within TPM for a single call.
 */
export function getContextWindow(model: string): number {
    const providerConfig = config.getProviderConfig('groq');

    let modelCtx = 32768; // fallback
    if (providerConfig?.contextWindow && providerConfig.model === model) {
        modelCtx = providerConfig.contextWindow;
    }

    // TPM is the hard ceiling on a single request's total tokens
    if (providerConfig?.tpmLimit && providerConfig.model === model) {
        return Math.min(modelCtx, providerConfig.tpmLimit);
    }

    return modelCtx;
}

export interface ContextUsage {
    usedTokens: number;
    maxTokens: number;
    percentage: number;
}

export function getContextUsage(messages: Message[], systemPrompt: string | undefined, model: string): ContextUsage {
    const maxTokens = getContextWindow(model);
    let usedTokens = estimateMessageTokens(messages);
    if (systemPrompt) usedTokens += estimateTokens(systemPrompt);
    const percentage = Math.min(100, Math.round((usedTokens / maxTokens) * 100));
    return { usedTokens, maxTokens, percentage };
}
