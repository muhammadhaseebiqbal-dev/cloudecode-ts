
import { config } from './config';
import { GroqProvider } from '../providers/groq';
import { OpenRouterProvider } from '../providers/openrouter';
import { OllamaProvider } from '../providers/ollama';
import { BaseProvider } from '../providers/base';

export function getProvider(name?: string): BaseProvider {
    const providerName = name || config.config.provider || 'groq';
    const conf = config.getProviderConfig(providerName);
    const apiKey = conf?.apiKey;
    const model = conf?.model;

    switch (providerName) {
        case 'openrouter':
            if (!apiKey) throw new Error('OpenRouter API key not configured. Please run setup first.');
            return new OpenRouterProvider(apiKey, model);
        case 'ollama':
            return new OllamaProvider(apiKey, model);
        case 'groq':
        default:
            if (!apiKey) throw new Error('API key not configured. Please run setup first.');
            return new GroqProvider(apiKey, model);
    }
}
