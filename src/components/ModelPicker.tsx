
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { config } from '../core/config';
import { GroqProvider } from '../providers/groq';
import { OpenRouterProvider } from '../providers/openrouter';
import { OllamaProvider } from '../providers/ollama';

interface ModelPickerProps {
    onSelect: (model: { id: string; contextWindow: number }) => void;
    onCancel: () => void;
}

const VISIBLE_COUNT = 12;

export const ModelPicker: React.FC<ModelPickerProps> = ({ onSelect, onCancel }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [models, setModels] = useState<{ id: string; contextWindow: number }[]>([]);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [scrollOffset, setScrollOffset] = useState(0);

    const currentProv = config.config.provider || 'groq';
    const activeModel = config.getProviderConfig(currentProv)?.model || '';

    useEffect(() => {
        const fetchModels = async () => {
            try {
                const apiKey = config.getProviderConfig(currentProv)?.apiKey || '';
                let fetched: { id: string; contextWindow: number }[];
                switch (currentProv) {
                    case 'openrouter':
                        if (!apiKey) throw new Error('No API key configured');
                        fetched = await OpenRouterProvider.fetchModels(apiKey);
                        break;
                    case 'ollama':
                        fetched = await OllamaProvider.fetchModels('');
                        break;
                    default:
                        if (!apiKey) throw new Error('No API key configured');
                        fetched = await GroqProvider.fetchModels(apiKey);
                        break;
                }
                setModels(fetched);
                // Pre-select the currently active model if found
                const activeIdx = fetched.findIndex(m => m.id === activeModel);
                if (activeIdx >= 0) {
                    setSelectedIdx(activeIdx);
                    setScrollOffset(Math.max(0, activeIdx - Math.floor(VISIBLE_COUNT / 2)));
                }
                setLoading(false);
            } catch (err: any) {
                setError(err?.message || 'Failed to fetch models');
                setLoading(false);
            }
        };
        fetchModels();
    }, []);

    useInput((_ch: string, key: any) => {
        if (key.escape) {
            onCancel();
            return;
        }

        if (loading || error) return;

        if (key.upArrow && selectedIdx > 0) {
            const newIdx = selectedIdx - 1;
            setSelectedIdx(newIdx);
            if (newIdx < scrollOffset) {
                setScrollOffset(newIdx);
            }
        }
        if (key.downArrow && selectedIdx < models.length - 1) {
            const newIdx = selectedIdx + 1;
            setSelectedIdx(newIdx);
            if (newIdx >= scrollOffset + VISIBLE_COUNT) {
                setScrollOffset(scrollOffset + 1);
            }
        }
        if (key.return) {
            const selected = models[selectedIdx];
            if (selected) {
                onSelect(selected);
            }
        }
    });

    if (error) {
        return (
            <Box flexDirection="column" width="100%">
                <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} width="100%">
                    <Text bold color="red">{'Model Selection Error'}</Text>
                    <Text color="#888">{error}</Text>
                    <Text color="#555">{'Press Esc to go back'}</Text>
                </Box>
            </Box>
        );
    }

    if (loading) {
        return (
            <Box flexDirection="column" width="100%">
                <Box flexDirection="column" borderStyle="round" borderColor="#87CEEB" paddingX={2} width="100%">
                    <Text bold color="#87CEEB">{`Select Model — ${currentProv}`}</Text>
                    <Box>
                        <Spinner type="dots" />
                        <Text color="#666">{' Fetching available models...'}</Text>
                    </Box>
                </Box>
            </Box>
        );
    }

    const windowEnd = Math.min(scrollOffset + VISIBLE_COUNT, models.length);
    const visibleSlice = models.slice(scrollOffset, windowEnd);
    const hasAbove = scrollOffset > 0;
    const hasBelow = windowEnd < models.length;

    return (
        <Box flexDirection="column" width="100%">
            <Box flexDirection="column" borderStyle="round" borderColor="#87CEEB" paddingX={2} width="100%">
                <Text bold color="#87CEEB">{`Select Model — ${currentProv}`}</Text>
                <Text color="#666">{`${selectedIdx + 1}/${models.length}  |  ↑↓: navigate  |  Enter: select  |  Esc: cancel`}</Text>

                {hasAbove ? <Text color="#555">{'  ...'}</Text> : null}

                {visibleSlice.map((model, visIdx) => {
                    const realIdx = scrollOffset + visIdx;
                    const isSelected = realIdx === selectedIdx;
                    const prefix = isSelected ? '› ' : '  ';
                    const ctx = model.contextWindow ? ` (${(model.contextWindow / 1000).toFixed(0)}k)` : '';
                    const active = model.id === activeModel ? ' ✓' : '';
                    return (
                        <Text key={realIdx} color={isSelected ? '#00FF7F' : 'white'} bold={isSelected}>
                            {`${prefix}${model.id}${ctx}${active}`}
                        </Text>
                    );
                })}

                {hasBelow ? <Text color="#555">{'  ...'}</Text> : null}
            </Box>
        </Box>
    );
};
