
import { structuredPatch } from 'diff';

/** A single line in the unified diff view */
export interface UnifiedDiffLine {
    type: 'add' | 'del' | 'context' | 'hunk';
    lineOld?: number;
    lineNew?: number;
    content: string;
    /** Word-level change highlights: array of [start, length] marking changed segments */
    highlights?: [number, number][];
}

export interface DiffResult {
    filePath: string;
    isNew: boolean;
    additions: number;
    deletions: number;
    hunks: number;
    lines: UnifiedDiffLine[];
    raw: string;
}

/**
 * Compute word-level diff highlights between two strings.
 * Returns array of [startIndex, length] for the changed segments.
 */
function wordHighlights(oldStr: string, newStr: string): { oldH: [number, number][]; newH: [number, number][] } {
    const oldH: [number, number][] = [];
    const newH: [number, number][] = [];

    // Find common prefix
    let prefixLen = 0;
    const minLen = Math.min(oldStr.length, newStr.length);
    while (prefixLen < minLen && oldStr[prefixLen] === newStr[prefixLen]) {
        prefixLen++;
    }

    // Find common suffix (not overlapping prefix)
    let suffixLen = 0;
    while (
        suffixLen < (minLen - prefixLen) &&
        oldStr[oldStr.length - 1 - suffixLen] === newStr[newStr.length - 1 - suffixLen]
    ) {
        suffixLen++;
    }

    const oldChangeStart = prefixLen;
    const oldChangeLen = oldStr.length - prefixLen - suffixLen;
    const newChangeStart = prefixLen;
    const newChangeLen = newStr.length - prefixLen - suffixLen;

    if (oldChangeLen > 0) oldH.push([oldChangeStart, oldChangeLen]);
    if (newChangeLen > 0) newH.push([newChangeStart, newChangeLen]);

    return { oldH, newH };
}

/**
 * Generate a unified diff with line numbers and word-level highlights.
 */
export function generateDiff(
    filePath: string,
    oldContent: string | null,
    newContent: string
): DiffResult {
    const isNew = oldContent === null || oldContent === undefined;

    if (isNew) {
        const newLines = newContent.split('\n');
        const lines: UnifiedDiffLine[] = [];
        for (let i = 0; i < newLines.length; i++) {
            lines.push({ type: 'add', lineNew: i + 1, content: newLines[i] });
        }
        return {
            filePath, isNew: true,
            additions: newLines.length, deletions: 0, hunks: 1,
            lines,
            raw: `New file: ${newLines.length} lines`
        };
    }

    const patch = structuredPatch(
        filePath, filePath,
        oldContent, newContent,
        '', '',
        { context: 3 }
    );

    const lines: UnifiedDiffLine[] = [];
    let additions = 0;
    let deletions = 0;

    for (const hunk of patch.hunks) {
        lines.push({
            type: 'hunk',
            content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
        });

        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        let i = 0;

        while (i < hunk.lines.length) {
            const ln = hunk.lines[i];

            if (ln.startsWith(' ')) {
                lines.push({
                    type: 'context',
                    lineOld: oldLine, lineNew: newLine,
                    content: ln.substring(1)
                });
                oldLine++; newLine++; i++;
            } else if (ln.startsWith('-')) {
                // Collect del/add blocks for word-level highlighting
                const delBlock: string[] = [];
                const delStart = oldLine;
                while (i < hunk.lines.length && hunk.lines[i].startsWith('-')) {
                    delBlock.push(hunk.lines[i].substring(1));
                    i++;
                }
                const addBlock: string[] = [];
                const addStart = newLine;
                while (i < hunk.lines.length && hunk.lines[i].startsWith('+')) {
                    addBlock.push(hunk.lines[i].substring(1));
                    i++;
                }

                // Emit del lines with word highlights (paired with add lines)
                for (let d = 0; d < delBlock.length; d++) {
                    let hl: [number, number][] | undefined;
                    if (d < addBlock.length) {
                        const { oldH } = wordHighlights(delBlock[d], addBlock[d]);
                        if (oldH.length > 0) hl = oldH;
                    }
                    lines.push({ type: 'del', lineOld: delStart + d, content: delBlock[d], highlights: hl });
                    deletions++;
                }
                // Emit add lines with word highlights
                for (let a = 0; a < addBlock.length; a++) {
                    let hl: [number, number][] | undefined;
                    if (a < delBlock.length) {
                        const { newH } = wordHighlights(delBlock[a], addBlock[a]);
                        if (newH.length > 0) hl = newH;
                    }
                    lines.push({ type: 'add', lineNew: addStart + a, content: addBlock[a], highlights: hl });
                    additions++;
                }

                oldLine = delStart + delBlock.length;
                newLine = addStart + addBlock.length;
            } else if (ln.startsWith('+')) {
                lines.push({ type: 'add', lineNew: newLine, content: ln.substring(1) });
                newLine++; additions++; i++;
            } else {
                i++;
            }
        }
    }

    return {
        filePath, isNew: false,
        additions, deletions,
        hunks: patch.hunks.length,
        lines,
        raw: `${additions} additions, ${deletions} deletions`
    };
}

/**
 * Compact diff for conversation history (token-efficient).
 */
export function compactDiff(diff: DiffResult, maxLines: number = 30): string {
    if (diff.isNew) {
        const total = diff.lines.length;
        if (total <= maxLines) {
            return `NEW FILE (${total} lines):\n` +
                diff.lines.map(l => `+ ${l.content}`).join('\n');
        }
        return `NEW FILE: ${total} lines written`;
    }

    if (diff.additions === 0 && diff.deletions === 0) {
        return 'No changes (file identical)';
    }

    const summary = `${diff.additions} additions, ${diff.deletions} deletions in ${diff.hunks} hunk(s)`;
    const changed = diff.lines.filter(l => l.type === 'add' || l.type === 'del' || l.type === 'hunk');
    if (changed.length === 0) return summary;

    const fmt = (l: UnifiedDiffLine): string => {
        if (l.type === 'hunk') return l.content;
        if (l.type === 'add') return `+ ${l.content}`;
        return `- ${l.content}`;
    };

    const display = changed.slice(0, maxLines);
    let result = summary + '\n' + display.map(fmt).join('\n');
    if (changed.length > maxLines) {
        result += `\n... (${changed.length - maxLines} more lines)`;
    }
    return result;
}
