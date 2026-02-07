
export const TOOLS = [
    {
        name: "read_file",
        description: "Read the contents of a file at the given path. Returns file metadata and content.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute or relative path to the file" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file. Creates parent directories if needed. Overwrites if the file already exists.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute or relative path to the file" },
                content: { type: "string", description: "Full content to write to the file" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "list_dir",
        description: "List contents of a directory. Shows directories first (with trailing /), then files.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute or relative directory path" }
            },
            required: ["path"]
        }
    },
    {
        name: "run_command",
        description: "Run a shell command. If the command runs longer than 15 seconds (e.g. a dev server), it is automatically backgrounded and a process ID is returned. If a similar server is already running, it will be auto-stopped first. Use get_logs to view output without stopping, or stop_process to terminate. Use the 'cwd' parameter to run in a specific directory instead of chaining cd commands.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Shell command to execute" },
                cwd: { type: "string", description: "Working directory to run the command in (absolute or relative path). Optional — defaults to current working directory." }
            },
            required: ["command"]
        }
    },
    {
        name: "stop_process",
        description: "Stop a background process by its ID. Returns the process output collected during its lifetime.",
        parameters: {
            type: "object",
            properties: {
                process_id: { type: "string", description: "The process ID (e.g. bg_1)" }
            },
            required: ["process_id"]
        }
    },
    {
        name: "list_processes",
        description: "List all background processes with their IDs, PIDs, ports, status, runtime, and command.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "get_logs",
        description: "View logs/output from a background process WITHOUT stopping it. Shows the last N lines of output (default 50). Use this to check server output, error logs, or build progress.",
        parameters: {
            type: "object",
            properties: {
                process_id: { type: "string", description: "The process ID (e.g. bg_1)" },
                tail: { type: "number", description: "Number of lines to show from the end (default 50)" }
            },
            required: ["process_id"]
        }
    },
    {
        name: "send_input",
        description: "Send text input to a running background process's stdin. Use this when a process is waiting for user input (e.g. interactive prompts like 'Would you like to use React Compiler? Y/N'). Send the appropriate response to continue the process. Check logs first to see what the process is asking.",
        parameters: {
            type: "object",
            properties: {
                process_id: { type: "string", description: "The process ID (e.g. bg_1)" },
                input: { type: "string", description: "The text to send to the process stdin (e.g. 'N', 'yes', 'my-project')" }
            },
            required: ["process_id", "input"]
        }
    },
    {
        name: "fetch_url",
        description: "Fetch content from a URL. Use this to read documentation pages, npm package info, GitHub READMEs, API references, release notes, etc. Returns the text content of the page. ALWAYS use this when you need up-to-date information about libraries, frameworks, or tools (e.g. latest Tailwind CSS syntax, latest React patterns, etc.).",
        parameters: {
            type: "object",
            properties: {
                url: { type: "string", description: "The URL to fetch (http or https)" }
            },
            required: ["url"]
        }
    }
];
