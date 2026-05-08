# Cloudé Code

Cloudé Code is a terminal-based agentic coding assistant for developers who want an AI pair programmer directly inside the command line. It can chat with supported LLM providers, inspect project files, write changes, run commands, manage long-running processes, and keep conversation context visible while you work.

The package installs a global `cloudecode` CLI.

## Features

- Interactive terminal UI built with Ink.
- First-run setup for Groq, OpenRouter, Google AI Studio, and Ollama.
- Dynamic model picker with context-window tracking.
- Tool use for reading files, writing files, listing directories, running shell commands, fetching URLs, and managing background processes.
- Permission prompts for higher-impact tools such as command execution and file writes.
- Session restore for recent conversations.
- Context usage meter with automatic compaction and backup restore support.
- Environment-variable and saved-config support for API keys.

## Installation

Install globally from npm:

```bash
npm install -g cloudecode-ts
```

Run the CLI:

```bash
cloudecode
```

You can also run it without a global install:

```bash
npx cloudecode-ts
```

## Requirements

- Node.js 18 or newer is recommended.
- npm for installation and publishing.
- An API key for Groq, OpenRouter, or Google AI Studio, unless you use local Ollama models.
- Ollama installed and running if you choose the Ollama provider.

## First Run

On first launch, Cloudé Code opens a setup flow:

1. Choose a provider.
2. Enter an API key if the provider requires one.
3. Let the CLI validate the connection and fetch available models.
4. Pick a model.
5. Start chatting from the terminal.

For Ollama, start the local service before setup:

```bash
ollama serve
```

Then make sure the model you want is available locally, for example:

```bash
ollama pull qwen2.5-coder:32b
```

## Providers

Cloudé Code currently supports:

| Provider | Key required | Notes |
| --- | --- | --- |
| Groq | Yes | Fast hosted inference. Default provider. |
| OpenRouter | Yes | Multi-model hosted gateway. |
| Google AI Studio | Yes | Gemini and Gemma model access through Google AI Studio. |
| Ollama | No | Local models through a running Ollama service. |

## API Keys

You can enter API keys during setup, or provide them through environment variables:

```bash
GROQ_API_KEY=your_groq_key
OPENROUTER_API_KEY=your_openrouter_key
GOOGLE_AI_STUDIO_API_KEY=your_google_ai_studio_key
```

Saved configuration is stored in the user config directory:

- Windows: `%APPDATA%\cloudecode\config.json`
- macOS/Linux: `$XDG_CONFIG_HOME/cloudecode/config.json` or `~/.config/cloudecode/config.json`

## Usage

Start Cloudé Code from the project directory you want to work in:

```bash
cd path/to/your/project
cloudecode
```

Then type natural-language requests such as:

```text
Find why the build is failing and fix it.
```

```text
Add input validation to the signup form and run the relevant tests.
```

```text
Read the README and package.json, then explain how this project is structured.
```

When the assistant wants to run a command, write a file, or stop a process, Cloudé Code asks for confirmation. You can approve once, reject, or allow that tool for the session.

## Slash Commands

Inside the chat UI, type `/` to see available commands.

| Command | Description |
| --- | --- |
| `/help` | Show available commands. |
| `/key` | Change the API key for the current provider. |
| `/model` | Open the model picker for the current provider. |
| `/provider` | Return to provider setup. |
| `/clear` | Clear the current chat history. |
| `/restore` | Restore context from the last backup. |
| `/reset` | Reset provider configuration and return to setup. |
| `/exit` | Exit Cloudé Code. |

Press `Esc` while a model request is running to cancel the in-flight request.

## Built-In Tools

Cloudé Code exposes these tools to the selected model:

| Tool | Purpose |
| --- | --- |
| `read_file` | Read a file and return metadata plus content. |
| `write_file` | Create or overwrite a file and show a compact diff. |
| `list_dir` | List directory contents. |
| `run_command` | Run shell commands in the current or requested working directory. |
| `list_processes` | Show background processes started by the CLI. |
| `get_logs` | Read logs from a background process without stopping it. |
| `send_input` | Send stdin input to a running background process. |
| `stop_process` | Stop a background process. |
| `fetch_url` | Fetch URL content for documentation or reference material. |

Commands that run longer than 15 seconds are automatically moved into the background. The CLI returns a process ID that can be used with `get_logs` or `stop_process`.

## Safety Model

Cloudé Code is designed for developer control:

- File writes show a diff summary.
- Command execution requires approval.
- Stopping background processes requires approval.
- Session-level approval is available when you trust the current workflow.
- Conversation history is saved locally so recent work can be restored.

Review generated changes before committing or publishing.

## Local Development

Install dependencies:

```bash
npm install
```

Run the TypeScript source directly:

```bash
npm run dev
```

Build the package:

```bash
npm run build
```

Run the compiled CLI:

```bash
npm start
```

## Publishing

Before publishing a new npm version:

```bash
npm install
npm run build
npm pack --dry-run
```

Then publish:

```bash
npm publish
```

The package runs `npm run build` automatically during `prepublishOnly`.

## Package Contents

The npm package includes:

- `dist/` compiled JavaScript CLI output.
- `config.md` system prompt and behavior configuration.
- `README.md`, `LICENSE`, and `package.json`.

## License

MIT
