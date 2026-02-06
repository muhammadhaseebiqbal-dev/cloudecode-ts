
import fs from 'fs-extra';
import execa, { ExecaChildProcess } from 'execa';
import path from 'path';

interface BgProcess {
    child: ExecaChildProcess;
    command: string;
    startTime: Date;
    stdout: string;
    stderr: string;
    running: boolean;
    exitCode: number | null;
}

const COMMAND_TIMEOUT = 15000; // 15s before auto-backgrounding

export class ToolExecutor {
    private cwd: string = process.cwd();
    private processes: Map<string, BgProcess> = new Map();
    private nextProcId = 1;

    getCwd(): string {
        return this.cwd;
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
                    return await this.runCommand(args.command);
                case 'stop_process':
                    return this.stopProcess(args.process_id);
                case 'list_processes':
                    return this.listProcesses();
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

    private async writeFile(filePath: string, content: string): Promise<string> {
        const resolved = this.resolvePath(filePath);
        const existed = await fs.pathExists(resolved);
        await fs.ensureDir(path.dirname(resolved));
        await fs.writeFile(resolved, content, 'utf-8');
        const lines = content.split('\n').length;
        const sizeBytes = Buffer.byteLength(content, 'utf-8');
        const sizeStr = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)}KB` : `${sizeBytes}B`;
        return `${existed ? 'UPDATED' : 'CREATED'}: ${resolved}\nSIZE: ${sizeStr} | LINES: ${lines}`;
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

    private async runCommand(command: string): Promise<string> {
        try {
            // Handle cd commands by changing the tracked cwd
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

            // Handle bare 'cd' (print current dir)
            if (command.trim().toLowerCase() === 'cd') {
                return `CWD: ${this.cwd}`;
            }

            // Start the process
            const child = execa(command, { shell: true, cwd: this.cwd });

            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
            child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

            // Race between completion and timeout
            const completed = await Promise.race([
                child.then(() => true).catch(() => true),
                new Promise<false>(resolve => setTimeout(() => resolve(false), COMMAND_TIMEOUT))
            ]);

            if (!completed) {
                // Auto-background long-running process
                const id = `bg_${this.nextProcId++}`;
                const proc: BgProcess = {
                    child, command,
                    startTime: new Date(),
                    stdout, stderr,
                    running: true,
                    exitCode: null
                };

                // Keep collecting output
                child.stdout?.on('data', (chunk: Buffer) => { proc.stdout += chunk.toString(); });
                child.stderr?.on('data', (chunk: Buffer) => { proc.stderr += chunk.toString(); });
                child.on('exit', (code) => {
                    proc.running = false;
                    proc.exitCode = code;
                });

                this.processes.set(id, proc);

                const preview = (stdout + stderr).substring(0, 300);
                return `BACKGROUNDED: Process auto-backgrounded after ${COMMAND_TIMEOUT / 1000}s\nPROCESS_ID: ${id}\nCOMMAND: ${command}\n${preview ? '---\n' + preview + (preview.length >= 300 ? '...' : '') : '(no output yet)'}\n\nUse stop_process("${id}") to terminate and get full output.`;
            }

            // Process completed within timeout
            try {
                await child;
            } catch (error: any) {
                const output = (stdout + (stderr ? '\nSTDERR:\n' + stderr : '')).trim();
                return `EXIT: ${error.exitCode || 1}\nCOMMAND: ${command}\nCWD: ${this.cwd}\n---\n${output || error.message}`;
            }

            const output = (stdout + (stderr ? '\nSTDERR:\n' + stderr : '')).trim();
            return `EXIT: 0\nCOMMAND: ${command}\nCWD: ${this.cwd}\n---\n${output || '(no output)'}`;

        } catch (error: any) {
            return `EXIT: ${error.exitCode || 1}\nCOMMAND: ${command}\nCWD: ${this.cwd}\n---\n${error.message}`;
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
            // Give it a moment then force kill
            setTimeout(() => {
                if (proc.running) proc.child.kill('SIGKILL');
            }, 3000);
        }

        const runtime = Math.round((Date.now() - proc.startTime.getTime()) / 1000);
        const output = (proc.stdout + (proc.stderr ? '\nSTDERR:\n' + proc.stderr : '')).trim();
        const truncated = output.length > 2000 ? output.substring(output.length - 2000) : output;

        this.processes.delete(processId);

        return `STOPPED: ${processId}\nCOMMAND: ${proc.command}\nRUNTIME: ${runtime}s\nEXIT: ${proc.exitCode ?? 'killed'}\n---\n${truncated || '(no output)'}`;
    }

    private listProcesses(): string {
        if (this.processes.size === 0) {
            return 'No background processes running.';
        }

        const lines: string[] = [];
        for (const [id, proc] of this.processes) {
            const runtime = Math.round((Date.now() - proc.startTime.getTime()) / 1000);
            const status = proc.running ? 'RUNNING' : `EXITED(${proc.exitCode})`;
            lines.push(`${id} | ${status} | ${runtime}s | ${proc.command}`);
        }

        return `PROCESSES: ${this.processes.size}\n---\nID | STATUS | RUNTIME | COMMAND\n${lines.join('\n')}`;
    }
}
