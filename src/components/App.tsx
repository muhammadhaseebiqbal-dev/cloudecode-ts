
import React, { useState, useRef } from 'react';
import { Box } from 'ink';
import { config } from '../core/config';
import { Setup } from './Setup';
import { Chat } from './Chat';
import { ModelPicker } from './ModelPicker';
import { printBranding } from '../branding';
import { fullClear } from '../core/ink';

const App = () => {
    // Compute initial view synchronously — no "Loading..." flash
    const _prov = config.config.provider || 'groq';
    const _conf = config.getProviderConfig(_prov);
    const initialView = (_conf?.apiKey && _conf?.model) ? 'chat' : 'setup';

    const [view, setView] = useState<'setup' | 'chat' | 'model-select'>(initialView);
    const [chatKey, setChatKey] = useState(0);
    // Ref to pass model-change result back to the current Chat instance
    const modelChangeRef = useRef<{ model: { id: string; contextWindow: number } } | null>(null);

    const handleReset = () => {
        fullClear();
        printBranding();
        setView('setup');
    };

    const handleClear = () => {
        fullClear();
        setChatKey(prev => prev + 1);
    };

    const handleSetupComplete = () => {
        fullClear();
        setChatKey(prev => prev + 1);
        setView('chat');
    };

    const handleModelChange = () => {
        fullClear();
        printBranding();
        setView('model-select');
    };

    const handleModelSelected = (model: { id: string; contextWindow: number }) => {
        const currentProv = config.config.provider || 'groq';
        config.setModel(currentProv, model.id, model.contextWindow);
        config.save();
        modelChangeRef.current = { model };
        fullClear();
        setChatKey(prev => prev + 1);
        setView('chat');
    };

    const handleModelCancel = () => {
        fullClear();
        setChatKey(prev => prev + 1);
        setView('chat');
    };

    return (
        <Box flexDirection="column">
            {view === 'setup' ? (
                <Setup onComplete={handleSetupComplete} />
            ) : view === 'model-select' ? (
                <ModelPicker onSelect={handleModelSelected} onCancel={handleModelCancel} />
            ) : (
                <Chat
                    key={chatKey}
                    onReset={handleReset}
                    onClear={handleClear}
                    onModelChange={handleModelChange}
                    modelChangeRef={modelChangeRef}
                />
            )}
        </Box>
    );
};

export default App;
