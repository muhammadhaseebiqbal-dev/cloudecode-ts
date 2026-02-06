
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { ConfigType, ProviderConfig } from './types';
import dotenv from 'dotenv';

dotenv.config();

const CONFIG_DIR = os.platform() === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'cloudecode')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'cloudecode');

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: ConfigType = {
    provider: 'groq',
    providers: {
        groq: {
            name: 'Groq',
            model: 'qwen-2.5-coder-32b',
            enabled: true
        }
    },
    theme: 'default',
    maxTokens: 8192
};

export class ConfigManager {
    config: ConfigType;

    constructor() {
        this.config = DEFAULT_CONFIG;
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const data = fs.readJsonSync(CONFIG_FILE);
                this.config = { ...DEFAULT_CONFIG, ...data };

                // Merge providers to ensure defaults exist
                this.config.providers = {
                    ...DEFAULT_CONFIG.providers,
                    ...(data.providers || {})
                };
            }
        } catch (error) {
            // Ignore errors, use defaults
        }

        // Load env vars
        this.loadEnvKeys();
    }

    loadEnvKeys() {
        const key = process.env.GROQ_API_KEY;
        if (key) {
            if (!this.config.providers.groq) {
                this.config.providers.groq = { name: 'Groq', model: 'qwen-2.5-coder-32b', enabled: true };
            }
            if (!this.config.providers.groq.apiKey) {
                this.config.providers.groq.apiKey = key;
            }
        }
    }

    save() {
        try {
            fs.ensureDirSync(CONFIG_DIR);
            fs.writeJsonSync(CONFIG_FILE, this.config, { spaces: 2 });
        } catch (error) {
            console.error('Failed to save config:', error);
        }
    }

    getProviderConfig(name: string): ProviderConfig | undefined {
        return this.config.providers[name];
    }

    setApiKey(provider: string, key: string) {
        if (!this.config.providers[provider]) {
            this.config.providers[provider] = { name: provider };
        }
        this.config.providers[provider].apiKey = key;
        this.save();
    }

    setModel(provider: string, model: string, contextWindow?: number, tpmLimit?: number) {
        if (!this.config.providers[provider]) {
            this.config.providers[provider] = { name: provider };
        }
        this.config.providers[provider].model = model;
        if (contextWindow) {
            this.config.providers[provider].contextWindow = contextWindow;
        }
        if (tpmLimit) {
            this.config.providers[provider].tpmLimit = tpmLimit;
        }
        this.save();
    }
}

export const config = new ConfigManager();
