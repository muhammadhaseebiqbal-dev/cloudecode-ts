
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
        description: "Run a shell command. If the command runs longer than 15 seconds (e.g. a dev server), it is automatically backgrounded and a process ID is returned. Use stop_process to terminate it.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Shell command to execute" }
            },
            required: ["command"]
        }
    },
    {
        name: "stop_process",
        description: "Stop a background process by its ID. Returns the process output collected during its lifetime. Use list_processes to see active processes.",
        parameters: {
            type: "object",
            properties: {
                process_id: { type: "string", description: "The process ID returned when the command was backgrounded (e.g. bg_1)" }
            },
            required: ["process_id"]
        }
    },
    {
        name: "list_processes",
        description: "List all background processes with their IDs, status, runtime, and command.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
];
