
import fs from 'fs-extra';
import execa, { ExecaChildProcess } from 'execa';
import path from 'path';
import http from 'http';
import https from 'https';
import { generateDiff, compactDiff, DiffResult } from '../core/diff';

interface BgProcess {
    child: ExecaChildProcess;
    command: string;
    startTime: Date;
    stdout: string;
    stderr: string;
    running: boolean;
    exitCode: number | null;
    port?: number; // track port for server dedup
}

/** Serializable process info that survives context compaction */
export interface ProcessInfo {
    id: string;
    command: string;
    startTime: string;
    running: boolean;
    port?: number;
    pid?: number;
}

const COMMAND_TIMEOUT = 15000;

// Patterns that indicate a server/long-running process
const SERVER_PATTERNS = [
    /npm\s+run\s+(dev|start|serve)/i,
    /npx\s+(vite|next|react-scripts)/i,
    /node\s+.*server/i,
    /python\s+-m\s+http\.server/i,
    /live-server/i,
];

// Extract port from a command or output
function extractPort(text: string): number | undefined {
    const match = text.match(/(?:port|PORT|localhost:|127\.0\.0\.1:)\s*(\d{4,5})/i)
        || text.match(/:(\d{4,5})/);
    return match ? parseInt(match[1]) : undefined;
}

export class ToolExecutor {
    private cwd: string = process.cwd();
    private processes: Map<string, BgProcess> = new Map();
    private nextProcId = 1;

    getCwd(): string {
        return this.cwd;
    }

    /** Get serializable snapshot of all processes (for context compaction) */
    getProcessSnapshot(): ProcessInfo[] {
        const snapshot: ProcessInfo[] = [];
        for (const [id, proc] of this.processes) {
            snapshot.push({
                id,
                command: proc.command,
                startTime: proc.startTime.toISOString(),
                running: proc.running,
                port: proc.port,
                pid: proc.child.pid
            });
        }
        return snapshot;
    }

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
                    return await this.runCommand(args.command, args.cwd);
                case 'stop_process':
                    return this.stopProcess(args.process_id);
                case 'list_processes':
                    return this.listProcesses();
                case 'get_logs':
                    return this.getLogs(args.process_id, args.tail);
                case 'send_input':
                    return await this.sendInput(args.process_id, args.input);
                case 'fetch_url':
                    return await this.fetchUrl(args.url);
                default:
                    return `Error: Unknown tool ${name}`;
            }
        } catch (error) {
            return `Error executing ${name}: ${String(error)}`;
        }
    }

    private resolvePath(p: string): string {
        if (path.isAbsolute(p)) return p;
        return path.resolve(this.cwd, p);
    }

    private async readFile(filePath: string): Promise<string> {
        const resolved = this.resolvePath(filePath);
        if (!await fs.pathExists(resolved)) {
            return `ERROR: File not found\nPath: ${resolved}`;
        }
        const content = await fs.readFile(resolved, 'utf-8');
        const lines = content.split('\n');
        const lineCount = lines.length;
        const sizeBytes = Buffer.byteLength(content, 'utf-8');
        const sizeStr = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)}KB` : `${sizeBytes}B`;
        return `PATH: ${resolved}\nSIZE: ${sizeStr} | LINES: ${lineCount}\n---\n${content}`;
    }

    public lastDiff: DiffResult | null = null;

    private async writeFile(filePath: string, content: string): Promise<string> {
        const resolved = this.resolvePath(filePath);
        const existed = await fs.pathExists(resolved);

        let oldContent: string | null = null;
        if (existed) {
            try {
                oldContent = await fs.readFile(resolved, 'utf-8');
            } catch {
                // Can't read old file
            }
        }

        await fs.ensureDir(path.dirname(resolved));
        await fs.writeFile(resolved, content, 'utf-8');

        const diff = generateDiff(resolved, oldContent, content);
        this.lastDiff = diff;
        const diffSummary = compactDiff(diff, 40);

        const lines = content.split('\n').length;
        const sizeBytes = Buffer.byteLength(content, 'utf-8');
        const sizeStr = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)}KB` : `${sizeBytes}B`;

        return `${existed ? 'UPDATED' : 'CREATED'}: ${resolved}\nSIZE: ${sizeStr} | LINES: ${lines}\nCHANGES: +${diff.additions} -${diff.deletions}\n---\n${diffSummary}`;
    }

    private async listDir(dirPath: string): Promise<string> {
        const resolved = this.resolvePath(dirPath);
        if (!await fs.pathExists(resolved)) {
            return `ERROR: Directory not found\nPath: ${resolved}`;
        }
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const dirs: string[] = [];
        const files: string[] = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                dirs.push(entry.name + '/');
            } else {
                files.push(entry.name);
            }
        }
        const listing = [...dirs.sort(), ...files.sort()];
        return `PATH: ${resolved}\nENTRIES: ${listing.length} (${dirs.length} dirs, ${files.length} files)\n---\n${listing.join('\n')}`;
    }

    /**
     * Auto-kill duplicate server processes before starting a new one.
     * If the new command matches a server pattern similar to an existing process, kill the old one.
     */
    private autoKillDuplicate(command: string): string | null {
        const isServer = SERVER_PATTERNS.some(p => p.test(command));
        if (!isServer) return null;

        for (const [id, proc] of this.processes) {
            if (!proc.running) continue;

            // Same command or same server type
            const isSameType = SERVER_PATTERNS.some(p => p.test(proc.command) && p.test(command));
            // Same working directory context (same project)
            if (isSameType) {
                // Kill the old one
                proc.child.kill('SIGTERM');
                setTimeout(() => { if (proc.running) proc.child.kill('SIGKILL'); }, 2000);
                proc.running = false;
                this.processes.delete(id);
                return `Auto-stopped previous server ${id} (${proc.command})`;
            }
        }
        return null;
    }

    private async runCommand(command: string, cwdOverride?: string): Promise<string> {
        // Resolve working directory
        const effectiveCwd = cwdOverride ? this.resolvePath(cwdOverride) : this.cwd;
        if (cwdOverride) {
            if (!await fs.pathExists(effectiveCwd)) {
                return `ERROR: Directory not found\nPath: ${effectiveCwd}`;
            }
            const stat = await fs.stat(effectiveCwd);
            if (!stat.isDirectory()) {
                return `ERROR: Not a directory\nPath: ${effectiveCwd}`;
            }
        }

        try {
            // Handle cd
            const cdMatch = command.match(/^cd\s+(.+)$/i);
            if (cdMatch) {
                const target = cdMatch[1].trim().replace(/["']/g, '');
                const newDir = this.resolvePath(target);
                if (await fs.pathExists(newDir)) {
                    const stat = await fs.stat(newDir);
                    if (stat.isDirectory()) {
                        this.cwd = newDir;
                        return `CWD: ${newDir}`;
                    }
                }
                return `ERROR: Directory not found\nPath: ${newDir}`;
            }
            if (command.trim().toLowerCase() === 'cd') {
                return `CWD: ${this.cwd}`;
            }

            // Auto-kill duplicate servers
            const killMsg = this.autoKillDuplicate(command);

            const child = execa(command, { shell: true, cwd: effectiveCwd, stdin: 'pipe' });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            const completed = await Promise.race([
                child.then(() => true).catch(() => true),
                new Promise<false>(resolve => setTimeout(() => resolve(false), COMMAND_TIMEOUT))
            ]);

            if (!completed) {
                const id = `bg_${this.nextProcId++}`;
                const port = extractPort(command) || extractPort(stdout + stderr);
                const proc: BgProcess = {
                    child, command,
                    startTime: new Date(),
                    stdout, stderr,
                    running: true,
                    exitCode: null,
                    port
                };

                child.stdout?.on('data', (chunk: Buffer) => { proc.stdout += chunk.toString(); });
                child.stderr?.on('data', (chunk: Buffer) => { proc.stderr += chunk.toString(); });
                child.on('exit', (code) => {
                    proc.running = false;
                    proc.exitCode = code;
                });

                this.processes.set(id, proc);

                const preview = (stdout + stderr).substring(0, 300);
                let result = `BACKGROUNDED: Process auto-backgrounded after ${COMMAND_TIMEOUT / 1000}s\nPROCESS_ID: ${id}\nCOMMAND: ${command}\nPID: ${child.pid || 'unknown'}`;
                if (port) result += `\nPORT: ${port}`;
                result += `\n${preview ? '---\n' + preview + (preview.length >= 300 ? '...' : '') : '(no output yet)'}`;
                result += `\n\nUse get_logs("${id}") to view output or stop_process("${id}") to terminate.`;
                if (killMsg) result = killMsg + '\n' + result;
                return result;
            }

            try {
                await child;
            } catch (error: any) {
                const output = (stdout + (stderr ? '\nSTDERR:\n' + stderr : '')).trim();
                let result = `EXIT: ${error.exitCode || 1}\nCOMMAND: ${command}\nCWD: ${effectiveCwd}\n---\n${output || error.message}`;
                if (killMsg) result = killMsg + '\n' + result;
                return result;
            }

            const output = (stdout + (stderr ? '\nSTDERR:\n' + stderr : '')).trim();
            let result = `EXIT: 0\nCOMMAND: ${command}\nCWD: ${effectiveCwd}\n---\n${output || '(no output)'}`;
            if (killMsg) result = killMsg + '\n' + result;
            return result;

        } catch (error: any) {
            return `EXIT: ${error.exitCode || 1}\nCOMMAND: ${command}\nCWD: ${effectiveCwd}\n---\n${error.message}`;
        }
    }

    private stopProcess(processId: string): string {
        const proc = this.processes.get(processId);
        if (!proc) {
            const ids = Array.from(this.processes.keys());
            return `ERROR: Process "${processId}" not found\nActive processes: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
        }

        if (proc.running) {
            proc.child.kill('SIGTERM');
            setTimeout(() => { if (proc.running) proc.child.kill('SIGKILL'); }, 3000);
        }

        const runtime = Math.round((Date.now() - proc.startTime.getTime()) / 1000);
        const output = (proc.stdout + (proc.stderr ? '\nSTDERR:\n' + proc.stderr : '')).trim();
        const truncated = output.length > 2000 ? output.substring(output.length - 2000) : output;

        this.processes.delete(processId);

        return `STOPPED: ${processId}\nCOMMAND: ${proc.command}\nRUNTIME: ${runtime}s\nEXIT: ${proc.exitCode ?? 'killed'}\n---\n${truncated || '(no output)'}`;
    }

    /**
     * Get logs from a running or exited background process WITHOUT stopping it.
     */
    private getLogs(processId: string, tail?: number): string {
        const proc = this.processes.get(processId);
        if (!proc) {
            const ids = Array.from(this.processes.keys());
            return `ERROR: Process "${processId}" not found\nActive processes: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
        }

        const runtime = Math.round((Date.now() - proc.startTime.getTime()) / 1000);
        const status = proc.running ? 'RUNNING' : `EXITED(${proc.exitCode})`;
        const fullOutput = (proc.stdout + (proc.stderr ? '\nSTDERR:\n' + proc.stderr : '')).trim();

        // Tail: show last N lines (default 50)
        const lines = fullOutput.split('\n');
        const tailCount = tail || 50;
        const displayLines = lines.length > tailCount ? lines.slice(-tailCount) : lines;
        const truncated = lines.length > tailCount;

        let result = `LOGS: ${processId}\nCOMMAND: ${proc.command}\nSTATUS: ${status}\nRUNTIME: ${runtime}s\nPID: ${proc.child.pid || 'unknown'}`;
        if (proc.port) result += `\nPORT: ${proc.port}`;
        result += `\nOUTPUT_LINES: ${lines.length}`;
        if (truncated) result += ` (showing last ${tailCount})`;
        result += `\n---\n${displayLines.join('\n') || '(no output)'}`;

        return result;
    }

    /**
     * Send input text to a background process's stdin.
     * Useful for interactive prompts (e.g. create-next-app asking questions).
     */
    private async sendInput(processId: string, input: string): Promise<string> {
        const proc = this.processes.get(processId);
        if (!proc) {
            const ids = Array.from(this.processes.keys());
            return `ERROR: Process "${processId}" not found\nActive processes: ${ids.length > 0 ? ids.join(', ') : 'none'}`;
        }

        if (!proc.running) {
            return `ERROR: Process "${processId}" is no longer running (exit code: ${proc.exitCode})`;
        }

        if (!proc.child.stdin) {
            return `ERROR: Process "${processId}" does not have an open stdin`;
        }

        try {
            proc.child.stdin.write(input + '\n');
            // Wait a moment for the process to react, then return recent output
            return new Promise<string>((resolve) => {
                setTimeout(() => {
                    const recentOutput = (proc.stdout + (proc.stderr ? '\nSTDERR:\n' + proc.stderr : '')).trim();
                    const lines = recentOutput.split('\n');
                    const lastLines = lines.slice(-20).join('\n');
                    resolve(`SENT: "${input}" to ${processId}\nSTATUS: ${proc.running ? 'running' : 'exited'}\n---\n${lastLines || '(waiting for output...)'}`);
                }, 1500);
            });
        } catch (error: any) {
            return `ERROR: Failed to send input to "${processId}": ${error.message}`;
        }
    }

    private listProcesses(): string {
        if (this.processes.size === 0) {
            return 'No background processes running.';
        }

        const lines: string[] = [];
        for (const [id, proc] of this.processes) {
            const runtime = Math.round((Date.now() - proc.startTime.getTime()) / 1000);
            const status = proc.running ? 'RUNNING' : `EXITED(${proc.exitCode})`;
            const portStr = proc.port ? ` :${proc.port}` : '';
            const pidStr = proc.child.pid ? ` pid:${proc.child.pid}` : '';
            lines.push(`${id} | ${status}${pidStr}${portStr} | ${runtime}s | ${proc.command}`);
        }

        return `PROCESSES: ${this.processes.size}\n---\nID | STATUS | RUNTIME | COMMAND\n${lines.join('\n')}`;
    }

    /**
     * Fetch a URL and return its text content.
     * Useful for reading documentation, npm pages, release notes, etc.
     */
    private fetchUrl(url: string, redirectCount: number = 0): Promise<string> {
        return new Promise((resolve) => {
            if (redirectCount > 5) {
                resolve(`ERROR: Too many redirects\nURL: ${url}`);
                return;
            }

            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, { headers: { 'User-Agent': 'CloudeCode/1.0' } }, (res) => {
                // Handle redirects — resolve relative URLs against original
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    let redirectUrl = res.headers.location;
                    if (redirectUrl.startsWith('/')) {
                        // Relative URL — resolve against original
                        const parsed = new URL(url);
                        redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
                    } else if (!redirectUrl.startsWith('http')) {
                        // Relative path without leading slash
                        const parsed = new URL(url);
                        const basePath = parsed.pathname.substring(0, parsed.pathname.lastIndexOf('/') + 1);
                        redirectUrl = `${parsed.protocol}//${parsed.host}${basePath}${redirectUrl}`;
                    }
                    this.fetchUrl(redirectUrl, redirectCount + 1).then(resolve);
                    return;
                }

                let data = '';
                res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        resolve(`ERROR: HTTP ${res.statusCode}\nURL: ${url}`);
                        return;
                    }

                    // Strip HTML tags for readability, keep text content
                    let text = data;
                    if (data.includes('<html') || data.includes('<!DOCTYPE')) {
                        // Remove script/style blocks
                        text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
                        text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
                        text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
                        text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
                        text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
                        // Convert common elements
                        text = text.replace(/<br\s*\/?>/gi, '\n');
                        text = text.replace(/<\/p>/gi, '\n\n');
                        text = text.replace(/<\/div>/gi, '\n');
                        text = text.replace(/<\/h[1-6]>/gi, '\n');
                        text = text.replace(/<h[1-6][^>]*>/gi, '\n## ');
                        text = text.replace(/<li[^>]*>/gi, '- ');
                        text = text.replace(/<\/li>/gi, '\n');
                        text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
                        text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```');
                        // Strip remaining tags
                        text = text.replace(/<[^>]+>/g, '');
                        // Clean up whitespace
                        text = text.replace(/&nbsp;/g, ' ');
                        text = text.replace(/&amp;/g, '&');
                        text = text.replace(/&lt;/g, '<');
                        text = text.replace(/&gt;/g, '>');
                        text = text.replace(/&quot;/g, '"');
                        text = text.replace(/\n{3,}/g, '\n\n');
                        text = text.trim();
                    }

                    // Truncate to reasonable size
                    const maxLen = 8000;
                    if (text.length > maxLen) {
                        text = text.substring(0, maxLen) + `\n\n... (truncated, ${text.length - maxLen} more chars)`;
                    }

                    resolve(`URL: ${url}\nSTATUS: ${res.statusCode}\nSIZE: ${data.length}B\n---\n${text}`);
                });
            });

            req.on('error', (err) => {
                resolve(`ERROR: ${err.message}\nURL: ${url}`);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                resolve(`ERROR: Request timed out\nURL: ${url}`);
            });
        });
    }
}
