
import React, { useState, useEffect } from 'react';
import { Box, Text, Static, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { config } from '../core/config';
import { getProvider } from '../core/factory';
import { Message } from '../core/types';
import { BaseProvider } from '../providers/base';
import { ToolExecutor } from '../tools/execution';
import { TOOLS } from '../tools/definitions';
import { SystemPromptManager } from '../core/prompt';
import { getContextUsage, ContextUsage } from '../core/context';
import { LOGO_LINES, TAGLINE, clearScreen } from '../branding';
import { estimateTokens, estimateMessageTokens } from '../core/context';
import { SessionManager } from '../core/session';

const executor = new ToolExecutor();
const MAX_TOOL_DEPTH = 15;
const CONTEXT_THRESHOLD = 90; // auto-summarize at 90%
const SEND_BUDGET_RATIO = 0.80; // use max 80% of limit for input, leave 20% for response

const DANGEROUS_TOOLS = ['run_command', 'write_file', 'stop_process'];

const SLASH_COMMANDS = [
    { cmd: '/reset',   desc: 'Reset API key & return to setup' },
    { cmd: '/clear',   desc: 'Clear chat history' },
    { cmd: '/restore', desc: 'Restore context from last backup' },
    { cmd: '/model',   desc: 'Show current model' },
    { cmd: '/help',    desc: 'Show available commands' },
];

interface ChatProps {
    onReset: () => void;
}

type PermissionPrompt = {
    toolName: string;
    args: Record<string, any>;
    resolve: (allowed: boolean) => void;
};

// Build a visual bar for context usage
function contextBar(pct: number, width: number = 20): string {
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
    return bar;
}

function contextColor(pct: number): string {
    if (pct < 50) return '#00D26A';
    if (pct < 75) return 'yellow';
    if (pct < 90) return '#FFA500';
    return 'red';
}

export const Chat: React.FC<ChatProps> = ({ onReset }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [provider, setProvider] = useState<BaseProvider | null>(null);
    const [status, setStatus] = useState('');
    const [initError, setInitError] = useState<string | null>(null);
    const [ready, setReady] = useState(false);
    const [permissionPrompt, setPermissionPrompt] = useState<PermissionPrompt | null>(null);
    const [sessionAllowed, setSessionAllowed] = useState<Set<string>>(new Set());
    const [contextUsage, setContextUsage] = useState<ContextUsage>({ usedTokens: 0, maxTokens: 32768, percentage: 0 });

    const currentModel = config.getProviderConfig('groq')?.model || 'qwen-2.5-coder-32b';

    // Update context usage whenever provider history changes
    const updateContextUsage = (p: BaseProvider) => {
        const usage = getContextUsage(
            p.conversationHistory,
            p.systemPrompt,
            currentModel
        );
        setContextUsage(usage);
    };

    useEffect(() => {
        try {
            const p = getProvider();
            const systemPrompt = SystemPromptManager.getSystemPrompt();
            p.setSystemPrompt(systemPrompt);
            setProvider(p);

            // Restore session if a recent one exists
            if (SessionManager.hasRecentSession()) {
                const session = SessionManager.load();
                if (session && session.history.length > 0) {
                    p.conversationHistory = session.history;
                    const resumeMsg: Message = {
                        role: 'system',
                        content: `Session restored (${session.history.length} messages from ${new Date(session.savedAt).toLocaleTimeString()}). Type /clear to start fresh.`
                    };
                    setMessages(session.displayMessages?.length
                        ? [...session.displayMessages, resumeMsg]
                        : [resumeMsg]
                    );
                }
            }

            updateContextUsage(p);
        } catch (err: any) {
            setInitError(err?.message || 'Failed to initialize provider');
        }
        setTimeout(() => setReady(true), 80);
    }, []);

    // Handle permission input
    useInput((ch: string) => {
        if (!permissionPrompt) return;

        if (ch === 'y' || ch === 'Y') {
            permissionPrompt.resolve(true);
            setPermissionPrompt(null);
        } else if (ch === 'n' || ch === 'N') {
            permissionPrompt.resolve(false);
            setPermissionPrompt(null);
        } else if (ch === 'a' || ch === 'A') {
            setSessionAllowed(prev => {
                const next = new Set(prev);
                next.add(permissionPrompt.toolName);
                return next;
            });
            permissionPrompt.resolve(true);
            setPermissionPrompt(null);
        }
    });

    const requestPermission = (toolName: string, args: Record<string, any>): Promise<boolean> => {
        if (sessionAllowed.has(toolName)) return Promise.resolve(true);
        if (!DANGEROUS_TOOLS.includes(toolName)) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
            setPermissionPrompt({ toolName, args, resolve });
        });
    };

    // Summarize and compact conversation when context is too large
    const summarizeContext = async (currentProvider: BaseProvider) => {
        setStatus('Compacting context...');

        // SAVE BACKUP before compaction — if anything fails, we can restore
        SessionManager.save(
            currentProvider.conversationHistory,
            messages,
            currentModel,
            process.cwd()
        );
        SessionManager.backup();

        const summaryPrompt: Message = {
            role: 'user',
            content: 'Summarize our conversation so far in a compact format. Include:\n- What the user asked for (the original task)\n- Files created or modified (with paths)\n- Current state of the task (what is done, what remains)\n- Any errors encountered\n- Key technical decisions\nFormat as bullet points. Be very concise. This summary will replace the conversation history so include everything needed to continue the task seamlessly.'
        };

        try {
            const systemPrompt = SystemPromptManager.getSystemPrompt();
            const response = await currentProvider.chatWithTools(
                [...currentProvider.conversationHistory, summaryPrompt],
                [],  // no tools for summary
                systemPrompt
            );

            const summary = response.content || 'Previous conversation context.';

            // Clear and replace with compact context
            // Use 'assistant' role so the AI treats it as its own memory, not something to respond to
            currentProvider.clearHistory();
            currentProvider.addMessage('user', '[The conversation was compacted to save context. Below is a summary of everything so far. Continue from where you left off.]');
            currentProvider.addMessage('assistant', `Here is my summary of our work so far:\n${summary}\n\nI will continue from where I left off.`);

            // Notify user (UI only — NOT added to provider history)
            const compactMsg: Message = {
                role: 'system',
                content: `Context compacted (was ${contextUsage.percentage}%). Summary preserved.`
            };
            setMessages(prev => [...prev, compactMsg]);
            updateContextUsage(currentProvider);
        } catch (err: any) {
            // Compaction failed (network error) — restore from backup
            const backup = SessionManager.restoreBackup();
            if (backup && backup.history.length > 0) {
                currentProvider.conversationHistory = backup.history;
                const restoreMsg: Message = { role: 'system', content: 'Compaction failed, context restored from backup.' };
                setMessages(prev => [...prev, restoreMsg]);
            } else {
                // No backup available, trim oldest messages as last resort
                const history = currentProvider.conversationHistory;
                const keepCount = Math.floor(history.length / 3);
                const kept = history.slice(-keepCount);
                currentProvider.conversationHistory = kept;
            }
            updateContextUsage(currentProvider);
        }
    };

    /**
     * Ensure conversation fits within the TPM budget before sending to API.
     * Strategy:
     *  1. Truncate large tool results (keep first/last 200 chars)
     *  2. Drop old tool result pairs if still over
     *  3. If still over, trigger full summarization
     * Returns true if context is within budget, false if still over after all attempts.
     */
    const ensureContextFits = async (currentProvider: BaseProvider): Promise<boolean> => {
        const maxTokens = getContextUsage(
            currentProvider.conversationHistory,
            currentProvider.systemPrompt,
            currentModel
        ).maxTokens;

        const budget = Math.floor(maxTokens * SEND_BUDGET_RATIO);

        const currentTokens = () => {
            let t = estimateMessageTokens(currentProvider.conversationHistory);
            if (currentProvider.systemPrompt) t += estimateTokens(currentProvider.systemPrompt);
            return t;
        };

        // Already within budget
        if (currentTokens() <= budget) return true;

        // Pass 1: Truncate large tool results in history (keep summary)
        for (const msg of currentProvider.conversationHistory) {
            if (msg.role === 'tool' && msg.content.length > 800) {
                const lines = msg.content.split('\n');
                const headerLines = lines.filter(l => /^[A-Z_]+:/.test(l));
                const header = headerLines.join('\n');
                const bodyStart = msg.content.indexOf('---');
                const body = bodyStart >= 0 ? msg.content.substring(bodyStart + 4) : msg.content;
                const truncBody = body.substring(0, 200) + '\n... (truncated)';
                msg.content = header ? `${header}\n---\n${truncBody}` : truncBody;
            }
        }

        if (currentTokens() <= budget) {
            updateContextUsage(currentProvider);
            return true;
        }

        // Pass 2: Drop old tool result/call pairs (keep last 4 exchanges)
        const history = currentProvider.conversationHistory;
        let i = 0;
        while (i < history.length - 8 && currentTokens() > budget) {
            if (history[i].role === 'tool') {
                history.splice(i, 1);
            } else {
                i++;
            }
        }
        currentProvider.conversationHistory = history;

        if (currentTokens() <= budget) {
            updateContextUsage(currentProvider);
            return true;
        }

        // Pass 3: Full summarization
        setStatus('Context too large, compacting...');
        // UI-only notification — not added to provider history
        const compactMsg: Message = {
            role: 'system',
            content: `Auto-compacting context to fit within ${(maxTokens / 1000).toFixed(0)}k token limit.`
        };
        setMessages(prev => [...prev, compactMsg]);
        await summarizeContext(currentProvider);

        return currentTokens() <= budget;
    };

    const processResponse = async (currentProvider: BaseProvider, depth: number = 0) => {
        if (depth >= MAX_TOOL_DEPTH) {
            const limitMsg: Message = { role: 'system', content: 'Tool call depth limit reached.' };
            setMessages(prev => [...prev, limitMsg]);
            return;
        }

        try {
            const systemPrompt = SystemPromptManager.getSystemPrompt();

            // Ensure context fits within TPM budget before sending
            await ensureContextFits(currentProvider);

            const response = await currentProvider.chatWithTools(
                currentProvider.conversationHistory,
                TOOLS,
                systemPrompt
            );

            if (response.type === 'error') {
                const errContent = response.content || 'Unknown error';
                // Handle 413 / rate limit errors by auto-compacting and retrying once
                if (errContent.includes('413') || errContent.includes('Request too large') || errContent.includes('tokens per minute')) {
                    setStatus('Request too large, compacting context...');
                    // UI-only notification
                    const trimMsg: Message = { role: 'system', content: 'Hit token limit, auto-compacting...' };
                    setMessages(prev => [...prev, trimMsg]);
                    await summarizeContext(currentProvider);
                    updateContextUsage(currentProvider);
                    // Retry once after compaction
                    await processResponse(currentProvider, depth + 1);
                    return;
                }
                const errorMsg: Message = { role: 'system', content: `Error: ${errContent}` };
                setMessages(prev => [...prev, errorMsg]);
                currentProvider.addMessage('assistant', errContent);
                updateContextUsage(currentProvider);
                return;
            }

            if (response.type === 'text') {
                const assistantMsg: Message = { role: 'assistant', content: response.content || '' };
                setMessages(prev => [...prev, assistantMsg]);
                currentProvider.addMessage('assistant', response.content || '');
                updateContextUsage(currentProvider);
                setStatus('');
                // Auto-save session after complete exchange
                SessionManager.save(
                    currentProvider.conversationHistory,
                    [...messages, assistantMsg],
                    currentModel,
                    process.cwd()
                );
            } else if (response.type === 'tool_use' && response.tool_calls) {
                const assistantMsg: Message = {
                    role: 'assistant',
                    content: response.content || '',
                    tool_calls: response.tool_calls
                };
                setMessages(prev => [...prev, assistantMsg]);
                currentProvider.addMessage('assistant', response.content || '', { tool_calls: response.tool_calls });

                for (const call of response.tool_calls) {
                    setStatus(`Running ${call.name}...`);

                    const allowed = await requestPermission(call.name, call.arguments);

                    let result: string;
                    if (!allowed) {
                        result = `Permission denied by user for ${call.name}`;
                        const denyMsg: Message = { role: 'system', content: `Blocked: ${call.name}` };
                        setMessages(prev => [...prev, denyMsg]);
                    } else {
                        result = await executor.execute(call.name, call.arguments);
                    }

                    const toolMsg: Message = {
                        role: 'tool',
                        content: result,
                        tool_call_id: call.id,
                        tool_name: call.name
                    };
                    setMessages(prev => [...prev, toolMsg]);
                    currentProvider.addMessage('tool', result, { tool_call_id: call.id });
                    updateContextUsage(currentProvider);
                }

                setStatus('Processing...');
                await processResponse(currentProvider, depth + 1);
            }
        } catch (error: any) {
            const errorMsg: Message = { role: 'system', content: `Error: ${error?.message || error}` };
            setMessages(prev => [...prev, errorMsg]);
            setStatus('');

            // If context is suspiciously small after error, restore from backup
            if (currentProvider.conversationHistory.length <= 3) {
                const backup = SessionManager.restoreBackup();
                if (backup && backup.history.length > currentProvider.conversationHistory.length) {
                    currentProvider.conversationHistory = backup.history;
                    const restoreMsg: Message = { role: 'system', content: 'Context restored from backup after error.' };
                    setMessages(prev => [...prev, restoreMsg]);
                    updateContextUsage(currentProvider);
                }
            }
        }
    };

    const handleSubmit = async (value: string) => {
        if (!value.trim() || !provider) return;
        const trimmed = value.trim();

        if (trimmed.startsWith('/')) {
            setInput('');
            switch (trimmed) {
                case '/reset':
                    config.config.providers.groq = { name: 'Groq', model: 'qwen-2.5-coder-32b', enabled: true };
                    config.config.provider = 'groq';
                    config.save();
                    SessionManager.clear();
                    clearScreen();
                    onReset();
                    return;
                case '/clear':
                    clearScreen();
                    setMessages([]);
                    if (provider) {
                        provider.clearHistory();
                        updateContextUsage(provider);
                    }
                    SessionManager.clear();
                    return;
                case '/restore': {
                    const backup = SessionManager.restoreBackup();
                    if (backup && backup.history.length > 0 && provider) {
                        provider.conversationHistory = backup.history;
                        if (backup.displayMessages?.length) {
                            setMessages(backup.displayMessages);
                        }
                        updateContextUsage(provider);
                        const restoredMsg: Message = { role: 'system', content: `Restored ${backup.history.length} messages from backup.` };
                        setMessages(prev => [...prev, restoredMsg]);
                    } else {
                        const noMsg: Message = { role: 'system', content: 'No backup found to restore.' };
                        setMessages(prev => [...prev, noMsg]);
                    }
                    return;
                }
                case '/model': {
                    const model = config.getProviderConfig('groq')?.model || 'unknown';
                    const sysMsg: Message = { role: 'system', content: `Model: ${model}` };
                    setMessages(prev => [...prev, sysMsg]);
                    return;
                }
                case '/help': {
                    const helpText = SLASH_COMMANDS.map(c => `  ${c.cmd}  ${c.desc}`).join('\n');
                    const helpMsg: Message = { role: 'system', content: `Commands:\n${helpText}` };
                    setMessages(prev => [...prev, helpMsg]);
                    return;
                }
                default: {
                    const unknownMsg: Message = { role: 'system', content: `Unknown: ${trimmed}. Type /help` };
                    setMessages(prev => [...prev, unknownMsg]);
                    return;
                }
            }
        }

        const userMsg: Message = { role: 'user', content: value };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsProcessing(true);
        setStatus('Thinking...');

        try {
            provider.addMessage('user', value);
            updateContextUsage(provider);
            // Smart context management — fits within TPM before sending
            await ensureContextFits(provider);
            await processResponse(provider);
        } catch (error: any) {
            const errorMsg: Message = { role: 'system', content: `Error: ${error?.message || error}` };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsProcessing(false);
            setStatus('');
        }
    };

    if (initError) {
        return (
            <Box borderStyle="single" borderColor="red" paddingX={1}>
                <Text color="red">{`Error: ${initError}`}</Text>
            </Box>
        );
    }

    const fmtArgs = (args: Record<string, any>): string => {
        if (args.command) return args.command;
        if (args.path && args.content) return `${args.path} (${args.content.length} chars)`;
        if (args.path) return args.path;
        if (args.process_id) return args.process_id;
        return JSON.stringify(args);
    };

    // Parse structured tool output into header/body
    const parseToolOutput = (content: string): { header: Record<string, string>; body: string } => {
        const header: Record<string, string> = {};
        const lines = content.split('\n');
        let bodyStart = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i] === '---') {
                bodyStart = i + 1;
                break;
            }
            const match = lines[i].match(/^([A-Z_]+):\s*(.+)$/);
            if (match) {
                header[match[1]] = match[2];
            } else {
                bodyStart = i;
                break;
            }
        }
        const body = lines.slice(bodyStart).join('\n');
        return { header, body };
    };

    // Get label + color for tool type
    const toolLabel = (name?: string): { label: string; color: string } => {
        switch (name) {
            case 'read_file':       return { label: 'READ',       color: '#87CEEB' };
            case 'write_file':      return { label: 'WRITE',      color: '#FFD700' };
            case 'list_dir':        return { label: 'DIR',        color: '#DDA0DD' };
            case 'run_command':     return { label: 'CMD',        color: '#FFA500' };
            case 'stop_process':    return { label: 'STOP',       color: '#FF6B6B' };
            case 'list_processes':  return { label: 'PROC',       color: '#87CEEB' };
            default:                return { label: 'TOOL',       color: '#888' };
        }
    };

    // Render tool result content based on tool type
    const renderToolResult = (msg: Message) => {
        const { header, body } = parseToolOutput(msg.content);
        const tl = toolLabel(msg.tool_name);
        const isError = msg.content.startsWith('ERROR:') || msg.content.startsWith('Permission denied');
        const isBg = header['BACKGROUNDED'] !== undefined;
        const maxBody = 500;
        const truncatedBody = body.length > maxBody ? body.substring(0, maxBody) + '\n... (' + (body.length - maxBody) + ' more chars)' : body;

        if (isError) {
            return (
                <Box paddingLeft={2} flexDirection="column">
                    <Box>
                        <Text color="red" bold>{`[${tl.label}] `}</Text>
                        <Text color="red">{msg.content.split('\n')[0]}</Text>
                    </Box>
                    {msg.content.split('\n').length > 1 ? (
                        <Box paddingLeft={2}>
                            <Text color="#555">{msg.content.split('\n').slice(1).join('\n')}</Text>
                        </Box>
                    ) : null}
                </Box>
            );
        }

        if (isBg) {
            return (
                <Box paddingLeft={2} flexDirection="column" borderStyle="single" borderColor="#FFA500" paddingX={1}>
                    <Box>
                        <Text color="#FFA500" bold>{'[BACKGROUNDED] '}</Text>
                        <Text color="white">{header['COMMAND'] || ''}</Text>
                    </Box>
                    <Box>
                        <Text color="#555">{`Process ID: `}</Text>
                        <Text color="#87CEEB" bold>{header['PROCESS_ID'] || ''}</Text>
                        <Text color="#555">{' | Use stop_process to terminate'}</Text>
                    </Box>
                    {truncatedBody.trim() ? (
                        <Box marginTop={1}>
                            <Text color="#666">{truncatedBody.trim()}</Text>
                        </Box>
                    ) : null}
                </Box>
            );
        }

        // Command results
        if (msg.tool_name === 'run_command') {
            const exitCode = header['EXIT'];
            const exitColor = exitCode === '0' ? '#00D26A' : '#FF6B6B';
            return (
                <Box paddingLeft={2} flexDirection="column">
                    <Box>
                        <Text color={tl.color} bold>{`[${tl.label}] `}</Text>
                        <Text color="#666">{header['COMMAND'] || ''}</Text>
                        {exitCode ? (
                            <Text color={exitColor}>{` (exit ${exitCode})`}</Text>
                        ) : null}
                    </Box>
                    {truncatedBody.trim() ? (
                        <Box paddingLeft={2}>
                            <Text color="#777" wrap="wrap">{truncatedBody.trim()}</Text>
                        </Box>
                    ) : null}
                </Box>
            );
        }

        // Write file results
        if (msg.tool_name === 'write_file') {
            const action = header['UPDATED'] ? 'Updated' : header['CREATED'] ? 'Created' : 'Wrote';
            const filePath = header['UPDATED'] || header['CREATED'] || '';
            return (
                <Box paddingLeft={2}>
                    <Text color={tl.color} bold>{`[${tl.label}] `}</Text>
                    <Text color="#00D26A">{`${action}: `}</Text>
                    <Text color="white">{filePath}</Text>
                    {header['SIZE'] ? (
                        <Text color="#555">{` (${header['SIZE']})`}</Text>
                    ) : null}
                </Box>
            );
        }

        // Read file results
        if (msg.tool_name === 'read_file') {
            return (
                <Box paddingLeft={2} flexDirection="column">
                    <Box>
                        <Text color={tl.color} bold>{`[${tl.label}] `}</Text>
                        <Text color="white">{header['PATH'] || ''}</Text>
                        {header['SIZE'] ? (
                            <Text color="#555">{` ${header['SIZE']}`}</Text>
                        ) : null}
                        {header['LINES'] ? (
                            <Text color="#555">{` | ${header['LINES']} lines`}</Text>
                        ) : null}
                    </Box>
                    {truncatedBody.trim() ? (
                        <Box paddingLeft={2}>
                            <Text color="#666" wrap="wrap">{truncatedBody.trim()}</Text>
                        </Box>
                    ) : null}
                </Box>
            );
        }

        // Directory listing
        if (msg.tool_name === 'list_dir') {
            return (
                <Box paddingLeft={2} flexDirection="column">
                    <Box>
                        <Text color={tl.color} bold>{`[${tl.label}] `}</Text>
                        <Text color="white">{header['PATH'] || ''}</Text>
                        <Text color="#555">{` (${header['ENTRIES'] || ''})`}</Text>
                    </Box>
                    {truncatedBody.trim() ? (
                        <Box paddingLeft={2}>
                            <Text color="#666" wrap="wrap">{truncatedBody.trim()}</Text>
                        </Box>
                    ) : null}
                </Box>
            );
        }

        // Stop process / list processes / generic
        if (msg.tool_name === 'stop_process') {
            return (
                <Box paddingLeft={2} flexDirection="column">
                    <Box>
                        <Text color={tl.color} bold>{`[${tl.label}] `}</Text>
                        <Text color="white">{header['STOPPED'] || ''}</Text>
                        {header['RUNTIME'] ? (
                            <Text color="#555">{` ran for ${header['RUNTIME']}`}</Text>
                        ) : null}
                    </Box>
                    {truncatedBody.trim() ? (
                        <Box paddingLeft={2}>
                            <Text color="#666" wrap="wrap">{truncatedBody.trim()}</Text>
                        </Box>
                    ) : null}
                </Box>
            );
        }

        // Generic fallback
        return (
            <Box paddingLeft={2}>
                <Text color={tl.color} bold>{`[${tl.label}] `}</Text>
                <Text color="#666" wrap="wrap">{msg.content.substring(0, 300)}{msg.content.length > 300 ? '...' : ''}</Text>
            </Box>
        );
    };

    const pct = contextUsage.percentage;
    const clr = contextColor(pct);
    const tokensK = (contextUsage.usedTokens / 1000).toFixed(1);
    const maxK = (contextUsage.maxTokens / 1000).toFixed(0);

    return (
        <Box flexDirection="column">
            <Static items={['logo' as const, ...messages]}>
                {(item, index) => {
                    if (item === 'logo') {
                        return (
                            <Box key="branding" flexDirection="column">
                                {LOGO_LINES.map((line, i) => (
                                    <Text key={i} color="#00D26A">{line}</Text>
                                ))}
                                <Text color="#555">{TAGLINE}</Text>
                                <Text>{' '}</Text>
                            </Box>
                        );
                    }
                    const msg = item as Message;
                    return (
                    <Box key={index} flexDirection="column">
                        {msg.role === 'user' ? (
                            <Box marginTop={1}>
                                <Text bold color="#00D26A">{'> '}</Text>
                                <Text color="white" bold>{msg.content}</Text>
                            </Box>
                        ) : null}

                        {msg.role === 'assistant' ? (
                            <Box borderStyle="round" borderColor="#333" paddingX={1} flexDirection="column" marginTop={1}>
                                <Text bold color="#00D26A">{'CLOUDE'}</Text>
                                {msg.content ? <Text color="white" wrap="wrap">{msg.content}</Text> : null}
                                {msg.tool_calls && msg.tool_calls.length > 0 ? (
                                    <Box flexDirection="column" marginTop={1}>
                                        {msg.tool_calls.map((tc: any, j: number) => {
                                            const tl = toolLabel(tc.name);
                                            return (
                                                <Box key={j}>
                                                    <Text color={tl.color} bold>{`[${tl.label}] `}</Text>
                                                    <Text color="#888">{fmtArgs(tc.arguments)}</Text>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                ) : null}
                            </Box>
                        ) : null}

                        {msg.role === 'tool' ? renderToolResult(msg) : null}

                        {msg.role === 'system' ? (
                            <Box paddingLeft={1}>
                                <Text color="#555">{'-- '}</Text>
                                <Text color="#888">{msg.content}</Text>
                            </Box>
                        ) : null}
                    </Box>
                    );
                }}
            </Static>

            {status && !permissionPrompt ? (
                <Box>
                    <Spinner type="dots" />
                    <Text color="#666">{' '}{status}</Text>
                </Box>
            ) : null}

            {permissionPrompt ? (
                <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
                    <Text bold color="yellow">{'Permission Required'}</Text>
                    <Box>
                        <Text color="white">{`${permissionPrompt.toolName}: `}</Text>
                        <Text color="#888">{fmtArgs(permissionPrompt.args)}</Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="#00D26A" bold>{'[Y] Allow'}</Text>
                        <Text color="#555">{' | '}</Text>
                        <Text color="red" bold>{'[N] Reject'}</Text>
                        <Text color="#555">{' | '}</Text>
                        <Text color="#87CEEB" bold>{'[A] Allow for session'}</Text>
                    </Box>
                </Box>
            ) : null}

            <Box justifyContent="flex-end" paddingX={2}>
                <Text color={clr}>{contextBar(pct, 10)}</Text>
                <Text color="#555">{` ${pct}% `}</Text>
                <Text color="#444">{`${tokensK}k/${maxK}k`}</Text>
            </Box>

            {!isProcessing && ready && !permissionPrompt ? (
                <Box borderStyle="round" borderColor="#00D26A" paddingX={1}>
                    <Text color="#00D26A">{'> '}</Text>
                    <TextInput
                        value={input}
                        onChange={setInput}
                        onSubmit={handleSubmit}
                        placeholder="Type a message... (/ for commands)"
                        focus={true}
                    />
                </Box>
            ) : null}
        </Box>
    );
};
