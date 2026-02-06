
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { config } from '../core/config';
import { Setup } from './Setup';
import { Chat } from './Chat';

const App = () => {
    const [view, setView] = useState<'setup' | 'chat'>('setup');
    const [configLoaded, setConfigLoaded] = useState(false);

    useEffect(() => {
        const conf = config.getProviderConfig('groq');
        if (conf?.apiKey && conf?.model) {
            setView('chat');
        } else {
            setView('setup');
        }
        setConfigLoaded(true);
    }, []);

    if (!configLoaded) return <Text>Loading...</Text>;

    return (
        <Box flexDirection="column">
            {view === 'setup' ? (
                <Setup onComplete={() => setView('chat')} />
            ) : (
                <Chat onReset={() => setView('setup')} />
            )}
        </Box>
    );
};

export default App;
