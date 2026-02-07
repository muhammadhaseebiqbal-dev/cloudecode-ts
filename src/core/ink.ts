/**
 * Bridge between Ink's render instance and components that need to clear the screen.
 *
 * Ink tracks its previous render output internally.  When we write raw ANSI
 * clear-screen codes to stdout, the terminal is visually blank but Ink's
 * diff-based renderer still thinks the old content is on screen.  On the
 * next re-render it appends instead of replacing in-place.
 *
 * Solution: call Ink's own `clear()` (which resets its tracking) BEFORE
 * the raw clear, so the two stay in sync.
 */

let _inkClear: (() => void) | null = null;

/** Called once from cli.tsx after render() returns. */
export function registerInkClear(fn: () => void): void {
    _inkClear = fn;
}

/**
 * Properly clear the terminal AND reset Ink's internal output tracking.
 * Use this everywhere instead of the raw `clearScreen()` from branding.ts.
 */
export function fullClear(): void {
    // 1. Reset Ink's tracked output so it doesn't try to diff against stale content
    if (_inkClear) _inkClear();
    // 2. Actually blank the terminal + scrollback and move cursor home
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}
