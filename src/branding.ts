
const LOGO_LINES = [
    '   ██████╗██╗      ██████╗ ██╗   ██╗██████╗ ███████╗',
    '  ██╔════╝██║     ██╔═══██╗██║   ██║██╔══██╗██╔════╝',
    '  ██║     ██║     ██║   ██║██║   ██║██║  ██║█████╗  ',
    '  ██║     ██║     ██║   ██║██║   ██║██║  ██║██╔══╝  ',
    '  ╚██████╗███████╗╚██████╔╝╚██████╔╝██████╔╝███████╗',
    '   ╚═════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝',
    '                   ██████╗ ██████╗ ██████╗ ███████╗',
    '                  ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
    '                  ██║     ██║   ██║██║  ██║█████╗  ',
    '                  ██║     ██║   ██║██║  ██║██╔══╝  ',
    '                  ╚██████╗╚██████╔╝██████╔╝███████╗',
    '                   ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
];

const TAGLINE = '    Open Source AI Terminal';

export { LOGO_LINES, TAGLINE };

export function clearScreen(): void {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

export function printBranding(): void {
    for (const line of LOGO_LINES) {
        process.stdout.write(`\x1b[38;2;0;210;106m${line}\x1b[0m\n`);
    }
    process.stdout.write(`\x1b[38;2;85;85;85m${TAGLINE}\x1b[0m\n\n`);
}
