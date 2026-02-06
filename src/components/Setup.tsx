
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { config } from '../core/config';
import { GroqProvider } from '../providers/groq';

interface SetupProps {
    onComplete: () => void;
}

const VISIBLE_COUNT = 10;

/** Check if a model is the Qwen 2.5 Coder model */
const isQwenCoder = (id: string) =>
    id.includes('qwen-2.5-coder-32b');

/** Build a flat display list: pin Qwen Coder to top, then categorized groups, no headers in selectable items */
function buildModelList(models: any[]): any[] {
    // Find and extract Qwen Coder
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
    const [step, setStep] = useState<'apikey' | 'verify' | 'models'>('apikey');
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isValidating, setIsValidating] = useState(false);
    const [selectedModelIdx, setSelectedModelIdx] = useState(0);
    const [availableModels, setAvailableModels] = useState<any[]>([]);
    const [scrollOffset, setScrollOffset] = useState(0);

    /** Get selectable (non-header) indices */
    const selectableIndices = availableModels
        .map((m, i) => (m.isHeader ? -1 : i))
        .filter(i => i !== -1);

    useInput((_input, key) => {
        if (step !== 'models') return;

        if (key.upArrow) {
            const curPos = selectableIndices.indexOf(selectedModelIdx);
            if (curPos > 0) {
                const newIdx = selectableIndices[curPos - 1];
                setSelectedModelIdx(newIdx);
                // Scroll up if needed
                if (newIdx < scrollOffset) {
                    // Jump scroll offset so newIdx's header (if any) or newIdx is visible
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
                // Scroll down if needed
                if (newIdx >= scrollOffset + VISIBLE_COUNT) {
                    setScrollOffset(newIdx - VISIBLE_COUNT + 1);
                }
            }
        }
        if (key.return) {
            const selectedModel = availableModels[selectedModelIdx];
            if (selectedModel && !selectedModel.isHeader) {
                config.setModel('groq', selectedModel.id);
                config.save();
                onComplete();
            }
        }
    });

    const validateAndFetchModels = async (key: string) => {
        if (!key.trim()) {
            setError('API key cannot be empty.');
            return;
        }

        setIsValidating(true);
        setError(null);
        setStep('verify');

        try {
            const provider = new GroqProvider(key);
            const isValid = await provider.validateConnection();

            if (!isValid) {
                setError('Invalid API key. Please check and try again.');
                setStep('apikey');
                setIsValidating(false);
                return;
            }

            config.setApiKey('groq', key);
            config.config.provider = 'groq';
            config.save();

            const fetchedModels = await GroqProvider.fetchModels(key);
            const flatList = buildModelList(fetchedModels);

            setAvailableModels(flatList);
            setScrollOffset(0);
            // Select first selectable item
            const firstSelectable = flatList.findIndex(m => !m.isHeader);
            if (firstSelectable !== -1) setSelectedModelIdx(firstSelectable);
            
            setStep('models');
        } catch (err: any) {
            setError(err.message || 'Verification failed');
            setStep('apikey');
        } finally {
            setIsValidating(false);
        }
    };

    if (step === 'apikey') {
        return (
            <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2}>
                <Text bold color="#00D26A">{'Setup — Groq'}</Text>
                <Text color="grey">{'Enter your API key to get started.'}</Text>
                <Text color="#666">{'https://console.groq.com/keys'}</Text>
                <Box marginTop={1}>
                    <Text color="#00D26A">{'> '}</Text>
                    <TextInput
                        value={apiKey}
                        onChange={setApiKey}
                        onSubmit={validateAndFetchModels}
                        mask="*"
                        placeholder="gsk_..."
                    />
                </Box>
                {error ? <Text color="red">{`${error}`}</Text> : null}
            </Box>
        );
    }

    if (step === 'verify') {
        return (
            <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2}>
                <Box>
                    <Spinner type="dots" />
                    <Text color="#666">{' Validating key & fetching models...'}</Text>
                </Box>
            </Box>
        );
    }

    if (step === 'models' && availableModels.length > 0) {
        // Windowed slice: show only VISIBLE_COUNT items from scrollOffset
        const windowEnd = Math.min(scrollOffset + VISIBLE_COUNT, availableModels.length);
        const visibleSlice = availableModels.slice(scrollOffset, windowEnd);
        const hasMore = windowEnd < availableModels.length;
        const hasAbove = scrollOffset > 0;
        const totalSelectable = selectableIndices.length;
        const currentPos = selectableIndices.indexOf(selectedModelIdx) + 1;

        return (
            <Box flexDirection="column" borderStyle="round" borderColor="#00D26A" paddingX={2}>
                <Text bold color="#00D26A">{'Select Model'}</Text>
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
        );
    }

    return <Text color="grey">{'Loading...'}</Text>;
};
