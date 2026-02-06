#!/usr/bin/env node

import React from 'react';
import { render } from 'ink';
import App from './components/App';

// Print logo once to stdout before Ink takes over
const LOGO = `
\x1b[38;2;0;210;106m   ██████╗██╗      ██████╗ ██╗   ██╗██████╗ ███████╗
  ██╔════╝██║     ██╔═══██╗██║   ██║██╔══██╗██╔════╝
  ██║     ██║     ██║   ██║██║   ██║██║  ██║█████╗  
  ██║     ██║     ██║   ██║██║   ██║██║  ██║██╔══╝  
  ╚██████╗███████╗╚██████╔╝╚██████╔╝██████╔╝███████╗
   ╚═════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝
                   ██████╗ ██████╗ ██████╗ ███████╗
                  ██╔════╝██╔═══██╗██╔══██╗██╔════╝
                  ██║     ██║   ██║██║  ██║█████╗  
                  ██║     ██║   ██║██║  ██║██╔══╝  
                  ╚██████╗╚██████╔╝██████╔╝███████╗
                   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝\x1b[0m
\x1b[90m    Open Source AI Terminal\x1b[0m
`;
console.clear();
console.log(LOGO);

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
