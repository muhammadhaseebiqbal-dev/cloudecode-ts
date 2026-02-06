
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export class SystemPromptManager {
    private static configPath = path.join(__dirname, '../../config.md');
    private static systemPrompt: string | null = null;

    static getSystemPrompt(): string {
        if (this.systemPrompt) return this.systemPrompt;

        try {
            const configContent = fs.readFileSync(this.configPath, 'utf-8');

            // Extract the core system prompt (everything is the prompt)
            this.systemPrompt = configContent;

            // Replace environment placeholders
            const cwd = process.cwd();
            const platform = os.platform();
            const home = os.homedir();
            const timestamp = new Date().toLocaleString();

            this.systemPrompt = this.systemPrompt
                .replace(/\{cwd\}/g, cwd)
                .replace(/\{platform\}/g, platform)
                .replace(/\{home\}/g, home)
                .replace(/\{timestamp\}/g, timestamp);

            return this.systemPrompt;
        } catch (error) {
            console.error('Failed to load system prompt from config.md:', error);
            // Fallback to basic prompt
            return `You are Cloudé Code, an expert AI coding assistant. You have access to tools like read_file, write_file, list_dir, and run_command. Use them proactively to help the user with coding tasks.`;
        }
    }

    static getContextualPrompt(context?: string): string {
        const basePrompt = this.getSystemPrompt();
        if (context) {
            return `${basePrompt}\n\n## Additional Context\n${context}`;
        }
        return basePrompt;
    }
}
