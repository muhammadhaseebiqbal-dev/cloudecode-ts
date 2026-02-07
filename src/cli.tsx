#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import App from './components/App';
import { clearScreen, printBranding } from './branding';
import { registerInkClear } from './core/ink';
import { config } from './core/config';

clearScreen();

// Print branding raw (outside Ink's tracking) for setup view
const _prov = config.config.provider || 'groq';
const _conf = config.getProviderConfig(_prov);
if (!(_conf?.apiKey && _conf?.model)) {
    printBranding();
}

// Render with proper Ink configuration
const { unmount, clear, waitUntilExit } = render(<App />, {
    exitOnCtrlC: true,
    patchConsole: false,
    debug: false
});

// Let components use Ink-aware screen clearing
registerInkClear(clear);

// Handle cleanup
process.on('SIGINT', () => {
    unmount();
    process.exit(0);
});
