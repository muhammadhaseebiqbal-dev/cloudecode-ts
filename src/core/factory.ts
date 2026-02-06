
import { config } from './config';
import { GroqProvider } from '../providers/groq';
import { BaseProvider } from '../providers/base';

export function getProvider(name?: string): BaseProvider {
    const providerName = name || config.config.provider || 'groq';
    const conf = config.getProviderConfig(providerName);
    const apiKey = conf?.apiKey;
    const model = conf?.model;

    if (!apiKey) {
        throw new Error('API key not configured. Please run setup first.');
    }

    return new GroqProvider(apiKey, model);
}
