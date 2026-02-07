
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { config } from '../core/config';
import { GroqProvider } from '../providers/groq';
import { OpenRouterProvider } from '../providers/openrouter';
import { OllamaProvider } from '../providers/ollama';


interface SetupProps {
    onComplete: () => void;
}

const VISIBLE_COUNT = 10;

/** Providers available for selection */
const PROVIDERS = [
    { id: 'groq', name: 'Groq', desc: 'Fast inference — requires API key', color: '#F55036', needsKey: true, keyUrl: 'https://console.groq.com/keys', placeholder: 'gsk_...' },
    { id: 'openrouter', name: 'OpenRouter', desc: 'Multi-model gateway — requires API key', color: '#6366F1', needsKey: true, keyUrl: 'https://openrouter.ai/keys', placeholder: 'sk-or-...' },
    { id: 'ollama', name: 'Ollama', desc: 'Local models — no API key needed', color: '#FFFFFF', needsKey: false, keyUrl: '', placeholder: '' },
];



/** Check if a model is the Qwen 2.5 Coder model */
const isQwenCoder = (id: string) =>
    id.includes('qwen-2.5-coder-32b');

/** Build a flat display list: pin recommended to top, then categorized groups */
function buildModelList(models: any[]): any[] {
    // Groq model list (original logic)
    const qwenIdx = models.findIndex(m => isQwenCoder(m.id));
    let qwenModel: any = null;
    const rest = [...models];
    if (qwenIdx !== -1) {
        qwenModel = { ...rest.splice(qwenIdx, 1)[0], recommended: true, pinned: true };
    }

    // Categorize remaining
    const fast: any[] = [];
    const allRounder: any[] = [];
    const context: any[] = [];

    for (const m of rest) {
        if (m.id.includes('8b') || m.id.includes('instant') || m.id.includes('gemma')) {
            fast.push(m);
        } else if (m.contextWindow >= 100000) {
            context.push(m);
        } else {
            allRounder.push(m);
        }
    }

    const result: any[] = [];

    // Pin Qwen at very top
    if (qwenModel) {
        result.push({ label: '[RECOMMENDED]', isHeader: true });
        result.push(qwenModel);
    }

    if (fast.length > 0) {
        result.push({ label: '[FAST]', isHeader: true });
        result.push(...fast);
    }
    if (allRounder.length > 0) {
        result.push({ label: '[ALL-ROUNDER]', isHeader: true });
        result.push(...allRounder);
    }
    if (context.length > 0) {
        result.push({ label: '[LARGE CONTEXT]', isHeader: true });
        result.push(...context);
    }

    return result;
}



export const Setup: React.FC<SetupProps> = ({ onComplete }) => {
    const [step, setStep] = useState<'provider' | 'apikey' | 'verify' | 'models' | 'probing'>('provider');
    const [selectedProvider, setSelectedProvider] = useState(0);
    const [chosenProvider, setChosenProvider] = useState<typeof PROVIDERS[0] | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [selectedModelIdx, setSelectedModelIdx] = useState(0);
    const [availableModels, setAvailableModels] = useState<any[]>([]);
    const [scrollOffset, setScrollOffset] = useState(0);

    /** Create a provider instance based on the chosen provider */
    const createProviderInstance = (providerId: string, key: string) => {
        switch (providerId) {
            case 'openrouter': return new OpenRouterProvider(key);
            case 'ollama': return new OllamaProvider('');
            default: return new GroqProvider(key);
        }
    };

    /** Fetch models for the chosen provider */
    const fetchModelsForProvider = async (providerId: string, key: string) => {
        switch (providerId) {
            case 'openrouter': return OpenRouterProvider.fetchModels(key);
            case 'ollama': return OllamaProvider.fetchModels('');
            default: return GroqProvider.fetchModels(key);
        }
    };

    /** Probe rate limits for the chosen provider */
    const probeForProvider = async (providerId: string, key: string, modelId: string) => {
        switch (providerId) {
            case 'openrouter': return OpenRouterProvider.probeRateLimit(key, modelId);
            case 'ollama': return OllamaProvider.probeRateLimit('', modelId);
            default: return GroqProvider.probeRateLimit(key, modelId);
        }
    };

    const startModelFetch = async (providerId: string, key: string) => {
        setIsValidating(true);
        setError(null);
        setStep('verify');

        try {
            const provider = createProviderInstance(providerId, key);
            const isValid = await provider.validateConnection();
            if (!isValid) {
                setError(providerId === 'ollama'
                    ? 'Cannot connect to Ollama. Is it running? (ollama serve)'
                    : 'Invalid API key. Please check and try again.');
                setStep(providerId === 'ollama' ? 'provider' : 'apikey');
                setIsValidating(false);
                return;
            }

            if (providerId !== 'ollama') {
                config.setApiKey(providerId, key);
            }
            config.config.provider = providerId;
            config.save();

            const fetchedModels = await fetchModelsForProvider(providerId, key);

            const flatList = buildModelList(fetchedModels);
            setAvailableModels(flatList);
            setScrollOffset(0);
            const firstSelectable = flatList.findIndex(m => !m.isHeader);
            if (firstSelectable !== -1) setSelectedModelIdx(firstSelectable);
            setStep('models');
        } catch (err: any) {
            setError(err.message || 'Verification failed');
            setStep(providerId === 'ollama' ? 'provider' : 'apikey');
        } finally {
            setIsValidating(false);
        }
    };

    useEffect(() => {
        // Auto-detect existing provider config
        const currentProvider = config.config.provider || 'groq';
        const providerInfo = PROVIDERS.find(p => p.id === currentProvider);
        if (providerInfo) {
            setChosenProvider(providerInfo);
            setSelectedProvider(PROVIDERS.indexOf(providerInfo));
            if (providerInfo.needsKey) {
                const existing = config.getProviderConfig(currentProvider)?.apiKey;
                if (existing) {
                    setApiKey(existing);
                    startModelFetch(currentProvider, existing);
                    return;
                }
            } else {
                // Ollama — no key needed, go straight to model fetch
                startModelFetch(currentProvider, '');
                return;
            }
        }
    }, []);

    /** Get selectable (non-header) indices */
    const selectableIndices = availableModels
        .map((m, i) => (m.isHeader ? -1 : i))
        .filter(i => i !== -1);

    const selectModel = async (model: any) => {
        if (!chosenProvider) return;
        setStep('probing');
        const savedKey = config.getProviderConfig(chosenProvider.id)?.apiKey || apiKey;
        const tpmLimit = await probeForProvider(chosenProvider.id, savedKey, model.id);
        config.setModel(chosenProvider.id, model.id, model.contextWindow, tpmLimit || undefined);
        config.save();
        onComplete();
    };

    useInput((_input, key) => {
        if (step === 'provider') {
            if (key.upArrow && selectedProvider > 0) {
                setSelectedProvider(selectedProvider - 1);
            }
            if (key.downArrow && selectedProvider < PROVIDERS.length - 1) {
                setSelectedProvider(selectedProvider + 1);
            }
            if (key.return) {
                const provider = PROVIDERS[selectedProvider];
                setChosenProvider(provider);
                if (provider.needsKey) {
                    // Check for existing key
                    const existing = config.getProviderConfig(provider.id)?.apiKey;
                    if (existing) {
                        setApiKey(existing);
                        startModelFetch(provider.id, existing);
                    } else {
                        setStep('apikey');
                    }
                } else {
                    // Ollama — skip API key step
                    startModelFetch(provider.id, '');
                }
            }
            return;
        }

        if (step !== 'models') return;

        if (key.upArrow) {
            const curPos = selectableIndices.indexOf(selectedModelIdx);
            if (curPos > 0) {
                const newIdx = selectableIndices[curPos - 1];
                setSelectedModelIdx(newIdx);
                if (newIdx < scrollOffset) {
                    const headerBefore = newIdx > 0 && availableModels[newIdx - 1]?.isHeader ? newIdx - 1 : newIdx;
                    setScrollOffset(Math.max(0, headerBefore));
                }
            }
        }
        if (key.downArrow) {
            const curPos = selectableIndices.indexOf(selectedModelIdx);
            if (curPos < selectableIndices.length - 1) {
                const newIdx = selectableIndices[curPos + 1];
                setSelectedModelIdx(newIdx);
                if (newIdx >= scrollOffset + VISIBLE_COUNT) {
                    setScrollOffset(newIdx - VISIBLE_COUNT + 1);
                }
            }
        }
        if (key.return) {
            const selectedModel = availableModels[selectedModelIdx];
            if (selectedModel && !selectedModel.isHeader) {
                selectModel(selectedModel);
            }
        }
    });

    const validateAndFetchModels = async (key: string) => {
        if (!key.trim()) {
            setError('API key cannot be empty.');
            return;
        }
        if (!chosenProvider) return;
        await startModelFetch(chosenProvider.id, key);
    };

    // ─── Provider Selection ───
    if (step === 'provider') {
        return (
            <Box flexDirection="column" width="100%">
                <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2} width="100%">
                    <Text bold color="#00D26A">{'Setup — Choose Provider'}</Text>
                    <Text color="#666">{'Select an AI provider to get started'}</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {PROVIDERS.map((p, i) => {
                            const isSelected = i === selectedProvider;
                            const prefix = isSelected ? '› ' : '  ';
                            return (
                                <Box key={p.id} flexDirection="row">
                                    <Text color={isSelected ? '#00FF7F' : 'white'} bold={isSelected}>
                                        {`${prefix}${p.name}`}
                                    </Text>
                                    <Text color="#666">{`  ${p.desc}`}</Text>
                                </Box>
                            );
                        })}
                    </Box>
                    {error ? <Text color="red">{`${error}`}</Text> : null}
                </Box>
            </Box>
        );
    }

    // ─── API Key / Token Entry ───
    if (step === 'apikey' && chosenProvider) {
        return (
            <Box flexDirection="column" width="100%">
                <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2} width="100%">
                    <Text bold color="#00D26A">{`Setup — ${chosenProvider.name}`}</Text>
                    <Text color="grey">{'Enter your API key to get started.'}</Text>
                    <Text color="#666">{chosenProvider.keyUrl}</Text>
                    <Box marginTop={1} width="100%">
                        <Text color="#00D26A">{'> '}</Text>
                        <TextInput
                            value={apiKey}
                            onChange={setApiKey}
                            onSubmit={validateAndFetchModels}
                            mask="*"
                            placeholder={chosenProvider.placeholder}
                        />
                    </Box>
                    {error ? <Text color="red">{`${error}`}</Text> : null}
                </Box>
            </Box>
        );
    }

    // ─── Verifying ───
    if (step === 'verify') {
        return (
            <Box flexDirection="column" width="100%">
                <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2} width="100%">
                    <Box>
                        <Spinner type="dots" />
                        <Text color="#666">{' Validating connection & fetching models...'}</Text>
                    </Box>
                </Box>
            </Box>
        );
    }

    // ─── Model Selection ───
    if (step === 'models' && availableModels.length > 0) {
        const windowEnd = Math.min(scrollOffset + VISIBLE_COUNT, availableModels.length);
        const visibleSlice = availableModels.slice(scrollOffset, windowEnd);
        const hasMore = windowEnd < availableModels.length;
        const hasAbove = scrollOffset > 0;
        const totalSelectable = selectableIndices.length;
        const currentPos = selectableIndices.indexOf(selectedModelIdx) + 1;
        const providerLabel = chosenProvider ? chosenProvider.name : '';

        return (
            <Box flexDirection="column" width="100%">
                <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2} width="100%">
                    <Text bold color="#00D26A">{`Select Model — ${providerLabel}`}</Text>
                    <Text color="#666">{`${currentPos}/${totalSelectable}  |  up/down: navigate  |  enter: select`}</Text>

                    {hasAbove ? <Text color="#555">{'  ...'}</Text> : null}

                    {visibleSlice.map((model, visIdx) => {
                        const realIdx = scrollOffset + visIdx;
                        if (model.isHeader) {
                            return (
                                <Text key={realIdx} bold color="#00CED1">{model.label}</Text>
                            );
                        }

                        const isSelected = realIdx === selectedModelIdx;
                        const prefix = isSelected ? '› ' : '  ';
                        const star = model.recommended || model.pinned ? '★ ' : '  ';
                        const ctx = model.contextWindow ? ` (${(model.contextWindow / 1000).toFixed(0)}k)` : '';

                        return (
                            <Text key={realIdx} color={isSelected ? '#00FF7F' : 'white'}>
                                {`${prefix}${star}${model.id}${ctx}`}
                            </Text>
                        );
                    })}

                    {hasMore ? <Text color="#555">{'  ...'}</Text> : null}
                </Box>
            </Box>
        );
    }

    // ─── Probing Rate Limits ───
    if (step === 'probing') {
        return (
            <Box flexDirection="column" width="100%">
                <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2} width="100%">
                    <Box>
                        <Spinner type="dots" />
                        <Text color="#666">{' Detecting rate limits for your plan...'}</Text>
                    </Box>
                </Box>
            </Box>
        );
    }

    return <Text color="grey">{'Loading...'}</Text>;
};
