#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import App from './components/App';
import { clearScreen } from './branding';

clearScreen();

// Render with proper Ink configuration
const { unmount, waitUntilExit } = render(<App />, {
    exitOnCtrlC: true,
    patchConsole: false,
    debug: false
});

// Handle cleanup
process.on('SIGINT', () => {
    unmount();
    process.exit(0);
});
