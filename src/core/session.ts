
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { Message } from './types';

const CONFIG_DIR = os.platform() === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'cloudecode')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'cloudecode');

const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');
const BACKUP_FILE = path.join(CONFIG_DIR, 'session.backup.json');

interface SessionData {
    history: Message[];
    displayMessages: Message[];
    model: string;
    cwd: string;
    savedAt: string;
}

export class SessionManager {
    /**
     * Save current conversation to disk.
     * Called after every exchange to ensure nothing is lost.
     */
    static save(history: Message[], displayMessages: Message[], model: string, cwd: string): void {
        try {
            fs.ensureDirSync(CONFIG_DIR);
            const data: SessionData = {
                history,
                displayMessages: displayMessages.slice(-100), // keep last 100 display messages
                model,
                cwd,
                savedAt: new Date().toISOString()
            };
            fs.writeJsonSync(SESSION_FILE, data, { spaces: 2 });
        } catch {
            // Silent fail — don't interrupt the user
        }
    }

    /**
     * Create a backup of the current session before compaction.
     * This preserves the FULL history so it can be restored if compaction
     * or the next API call fails.
     */
    static backup(): void {
        try {
            if (fs.existsSync(SESSION_FILE)) {
                fs.copyFileSync(SESSION_FILE, BACKUP_FILE);
            }
        } catch {
            // Silent fail
        }
    }

    /**
     * Load the most recent session (regular or backup).
     * Prefers the regular session file. Falls back to backup.
     */
    static load(): SessionData | null {
        try {
            if (fs.existsSync(SESSION_FILE)) {
                return fs.readJsonSync(SESSION_FILE) as SessionData;
            }
        } catch {
            // Corrupted session file — try backup
        }

        try {
            if (fs.existsSync(BACKUP_FILE)) {
                return fs.readJsonSync(BACKUP_FILE) as SessionData;
            }
        } catch {
            // Both corrupted
        }

        return null;
    }

    /**
     * Restore from backup (used when compaction fails or network error after compaction).
     */
    static restoreBackup(): SessionData | null {
        try {
            if (fs.existsSync(BACKUP_FILE)) {
                return fs.readJsonSync(BACKUP_FILE) as SessionData;
            }
        } catch {
            // Corrupted backup
        }
        return null;
    }

    /**
     * Check if a session exists and is recent (within 2 hours).
     */
    static hasRecentSession(): boolean {
        try {
            if (!fs.existsSync(SESSION_FILE)) return false;
            const data = fs.readJsonSync(SESSION_FILE) as SessionData;
            if (!data.savedAt || !data.history?.length) return false;
            const age = Date.now() - new Date(data.savedAt).getTime();
            const TWO_HOURS = 2 * 60 * 60 * 1000;
            return age < TWO_HOURS;
        } catch {
            return false;
        }
    }

    /**
     * Clear session files (on /clear or /reset).
     */
    static clear(): void {
        try {
            if (fs.existsSync(SESSION_FILE)) fs.removeSync(SESSION_FILE);
            if (fs.existsSync(BACKUP_FILE)) fs.removeSync(BACKUP_FILE);
        } catch {
            // Silent fail
        }
    }
}
