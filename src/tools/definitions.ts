
export const TOOLS = [
    {
        name: "read_file",
        description: "Read the contents of a file",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file. Overwrites if exists.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file" },
                content: { type: "string", description: "Content to write" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "list_dir",
        description: "List contents of a directory",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Directory path" }
            },
            required: ["path"]
        }
    },
    {
        name: "run_command",
        description: "Run a shell command",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Command to execute" }
            },
            required: ["command"]
        }
    }
];
