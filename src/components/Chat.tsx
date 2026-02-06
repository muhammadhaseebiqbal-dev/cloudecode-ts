
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

const executor = new ToolExecutor();
const MAX_TOOL_DEPTH = 15;

// Tools that need explicit permission
const DANGEROUS_TOOLS = ['run_command', 'write_file'];

const SLASH_COMMANDS = [
    { cmd: '/reset', desc: 'Reset API key & return to setup' },
    { cmd: '/clear', desc: 'Clear chat history' },
    { cmd: '/model', desc: 'Show current model' },
    { cmd: '/help',  desc: 'Show available commands' },
];

interface ChatProps {
    onReset: () => void;
}

type PermissionPrompt = {
    toolName: string;
    args: Record<string, any>;
    resolve: (allowed: boolean) => void;
};

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

    useEffect(() => {
        try {
            const p = getProvider();
            const systemPrompt = SystemPromptManager.getSystemPrompt();
            p.setSystemPrompt(systemPrompt);
            setProvider(p);
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

    const processResponse = async (currentProvider: BaseProvider, depth: number = 0) => {
        if (depth >= MAX_TOOL_DEPTH) {
            const limitMsg: Message = { role: 'system', content: 'Tool call depth limit reached.' };
            setMessages(prev => [...prev, limitMsg]);
            return;
        }

        try {
            const systemPrompt = SystemPromptManager.getSystemPrompt();
            const response = await currentProvider.chatWithTools(
                currentProvider.conversationHistory,
                TOOLS,
                systemPrompt
            );

            if (response.type === 'error') {
                const errorMsg: Message = { role: 'system', content: `Error: ${response.content || 'Unknown error'}` };
                setMessages(prev => [...prev, errorMsg]);
                currentProvider.addMessage('assistant', response.content || 'Error occurred');
                return;
            }

            if (response.type === 'text') {
                const assistantMsg: Message = { role: 'assistant', content: response.content || '' };
                setMessages(prev => [...prev, assistantMsg]);
                currentProvider.addMessage('assistant', response.content || '');
                setStatus('');
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
                        tool_call_id: call.id
                    };
                    setMessages(prev => [...prev, toolMsg]);
                    currentProvider.addMessage('tool', result, { tool_call_id: call.id });
                }

                setStatus('Processing...');
                await processResponse(currentProvider, depth + 1);
            }
        } catch (error: any) {
            const errorMsg: Message = { role: 'system', content: `Error: ${error?.message || error}` };
            setMessages(prev => [...prev, errorMsg]);
            setStatus('');
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
                    process.stdout.write('\x1b[2J\x1b[H');
                    onReset();
                    return;
                case '/clear':
                    process.stdout.write('\x1b[2J\x1b[H');
                    setMessages([]);
                    if (provider) provider.clearHistory();
                    return;
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
        return JSON.stringify(args);
    };

    return (
        <Box flexDirection="column">
            <Static items={messages}>
                {(msg, index) => (
                    <Box key={index} flexDirection="column">
                        {msg.role === 'user' ? (
                            <Box>
                                <Text bold color="#00D26A">{'> '}</Text>
                                <Text color="white" bold>{msg.content}</Text>
                            </Box>
                        ) : null}

                        {msg.role === 'assistant' ? (
                            <Box borderStyle="round" borderColor="#333" paddingX={1} flexDirection="column" marginTop={1}>
                                <Text bold color="#00D26A">{'CLOUDE'}</Text>
                                {msg.content ? <Text color="white" wrap="wrap">{msg.content}</Text> : null}
                                {msg.tool_calls ? (
                                    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="#333" paddingX={1}>
                                        {msg.tool_calls.map((tc: any, j: number) => (
                                            <Text key={j} color="#666">{`${tc.name}(${Object.values(tc.arguments).map((v: any) => typeof v === 'string' && v.length > 40 ? v.substring(0, 40) + '...' : v).join(', ')})`}</Text>
                                        ))}
                                    </Box>
                                ) : null}
                            </Box>
                        ) : null}

                        {msg.role === 'tool' ? (
                            <Box paddingX={2}>
                                <Text color="#555">{msg.content.substring(0, 200).replace(/\n/g, ' ')}{msg.content.length > 200 ? '...' : ''}</Text>
                            </Box>
                        ) : null}

                        {msg.role === 'system' ? (
                            <Box>
                                <Text color="yellow">{msg.content}</Text>
                            </Box>
                        ) : null}
                    </Box>
                )}
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

            {!isProcessing && ready && !permissionPrompt ? (
                <Box borderStyle="round" borderColor="#00D26A" paddingX={1} marginTop={1}>
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
