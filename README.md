# DeepWiki for VS Code

An interactive, AI-powered codebase encyclopedia for standard VS Code, extracted and adapted from Devin Desktop / Windsurf.

![DeepWiki](media/deepwiki.png)

## Features

- **Interactive Symbol Articles**: Generate comprehensive architectural articles for any function, class, interface, method, or module.
- **Enhanced Code Blocks**: File header with jump-to-source links, line citations (`#line`), one-click code copy, and collapsible code sections for long blocks.
- **Deep Exploration Chips**: Real-time follow-up question bubbles at the bottom of each article to dig deeper into edge cases, invariants, and dependencies.
- **Pluggable AI Backends**:
  - **Ollama** (Default - private, local, zero-config: `llama3.2`, `codellama`, `deepseek-coder`, etc.)
  - **OpenAI / Compatible** (OpenAI, DeepSeek, Groq, local vLLM/LMStudio)
  - **Anthropic** (Claude 3.5 Sonnet)
  - **Google Gemini** (Gemini 2.0 Flash)
  - **Devin Local Bridge** (Connects directly to Devin Desktop language server if running)
- **Navigation History**: Back and forward browsing across explored symbols.

## How to Use

1. Click on any function, class, or variable in your editor.
2. Press **`Cmd+Shift+D`** (macOS) or **`Ctrl+Shift+D`** (Windows / Linux).
3. Alternatively, right-click the symbol and choose **"Open Symbol in DeepWiki"**.
4. The DeepWiki sidebar will open, stream the documentation article, and render interactive follow-up questions.

## Configuration

In VS Code Settings (`Ctrl+,` or `Cmd+,`), search for **DeepWiki**:

- `deepwiki.provider`: Select your preferred AI backend (`ollama`, `openai`, `anthropic`, `gemini`, `devin_bridge`).
- `deepwiki.model`: Model name (default: `llama3.2`).
- `deepwiki.apiKey`: API Key (required for cloud providers).
- `deepwiki.apiBaseUrl`: Custom API Base URL (defaults to `http://localhost:11434` for Ollama).
