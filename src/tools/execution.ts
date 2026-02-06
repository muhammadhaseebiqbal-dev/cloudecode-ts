
import fs from 'fs-extra';
import execa from 'execa';
import path from 'path';

export class ToolExecutor {
    async execute(name: string, args: any): Promise<string> {
        try {
            switch (name) {
                case 'read_file':
                    return await this.readFile(args.path);
                case 'write_file':
                    return await this.writeFile(args.path, args.content);
                case 'list_dir':
                    return await this.listDir(args.path);
                case 'run_command':
                    return await this.runCommand(args.command);
                default:
                    return `Error: Unknown tool ${name}`;
            }
        } catch (error) {
            return `Error executing ${name}: ${String(error)}`;
        }
    }

    private async readFile(filePath: string): Promise<string> {
        if (!await fs.pathExists(filePath)) {
            return `Error: File not found at ${filePath}`;
        }
        const content = await fs.readFile(filePath, 'utf-8');
        return content;
    }

    private async writeFile(filePath: string, content: string): Promise<string> {
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, content, 'utf-8');
        return `Successfully wrote to ${filePath}`;
    }

    private async listDir(dirPath: string): Promise<string> {
        if (!await fs.pathExists(dirPath)) {
            return `Error: Directory not found at ${dirPath}`;
        }
        const files = await fs.readdir(dirPath);
        return files.join('\n');
    }

    private async runCommand(command: string): Promise<string> {
        try {
            const { stdout, stderr } = await execa(command, { shell: true });
            if (stderr) return `${stdout}\nSTDERR:\n${stderr}`;
            return stdout;
        } catch (error: any) {
            return `Failed: ${error.message}`;
        }
    }
}
