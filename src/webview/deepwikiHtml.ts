import * as vscode from "vscode";

export function getDeepWikiWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "deepwiki.css")
  );
  const markedUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "marked.min.js")
  );
  const highlightUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "highlight.min.js")
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "deepwikiWebview.js")
  );
  const logoUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "deepwiki.svg")
  );

  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
  <title>DeepWiki</title>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body class="bg-slate-950 text-slate-100">
  <div class="deepwiki-view">
    <!-- Header / Symbol Bar -->
    <header class="deepwiki-header">
      <div class="deepwiki-header-row">
        <div class="deepwiki-symbol-header-container">
          <div class="deepwiki-symbol-left">
            <div class="deepwiki-symbol-icon">
              <img src="${logoUri}" alt="DeepWiki" style="width: 16px; height: 16px;">
            </div>
            <div style="min-width: 0; flex: 1;">
              <div style="display: flex; align-items: center;">
                <span id="symbol-name" class="deepwiki-symbol-title">DeepWiki</span>
                <span id="symbol-kind" class="deepwiki-symbol-kind-tag">Encyclopedia</span>
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <a id="symbol-link" class="deepwiki-symbol-link" style="font-size: 11px; opacity: 0.85;">No symbol selected</a>
                <span id="model-badge" class="deepwiki-model-type-indicator" style="display: none;">DeepWiki</span>
              </div>
            </div>
          </div>
          <div class="deepwiki-symbol-actions">
            <button id="btn-back" class="deepwiki-btn" title="Back" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button id="btn-forward" class="deepwiki-btn" title="Forward" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <button id="btn-copy" class="deepwiki-btn" title="Copy Markdown">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <button id="btn-refresh" class="deepwiki-btn" title="Refresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            </button>
          </div>
        </div>
      </div>
    </header>

    <!-- Main Content Container -->
    <main class="deepwiki-content-container">
      <!-- Welcome Empty State -->
      <div id="welcome-container" class="deepwiki-welcome">
        <img src="${logoUri}" alt="DeepWiki" class="deepwiki-welcome-icon">
        <h2>Welcome to DeepWiki</h2>
        <p>Interactive code encyclopedia for your codebase. Explore symbols, architecture, and contracts.</p>
        <div>
          <span class="deepwiki-welcome-shortcut">Cmd+Shift+D</span> or <span class="deepwiki-welcome-shortcut">Ctrl+Shift+D</span> on any symbol
        </div>
        <div style="margin-top: 12px; font-size: 11px; color: var(--vscode-descriptionForeground);">
          Right-click any function, class, or variable &rarr; <em>Open Symbol in DeepWiki</em>
        </div>
      </div>

      <!-- Article View -->
      <div id="article-container" style="display: none; flex-direction: column;">
        <!-- Skeleton Loader during generation -->
        <div id="skeleton-loader" class="deepwiki-skeleton-loader" style="display: none;">
          <div class="deepwiki-skeleton-item deepwiki-skeleton-title"></div>
          <div class="deepwiki-skeleton-item deepwiki-skeleton-paragraph long"></div>
          <div class="deepwiki-skeleton-item deepwiki-skeleton-paragraph medium"></div>
          <div class="deepwiki-skeleton-item deepwiki-skeleton-heading"></div>
          <div class="deepwiki-skeleton-item deepwiki-skeleton-paragraph long"></div>
          <div class="deepwiki-skeleton-item deepwiki-skeleton-paragraph short"></div>
          <div class="deepwiki-skeleton-item" style="height: 120px; width: 100%; border-radius: 6px;"></div>
        </div>

        <!-- Rendered Article -->
        <article id="article-content" class="deepwiki-article-content"></article>

        <!-- Follow-up Questions -->
        <section id="followup-container" class="deepwiki-follow-up-questions" style="display: none;">
          <div class="deepwiki-follow-up-questions-header">
            <h3>Explore Further</h3>
          </div>
          <div id="followup-list"></div>

          <!-- Custom question input -->
          <div class="deepwiki-custom-question-container">
            <div class="deepwiki-custom-question-row">
              <input type="text" id="custom-question-input" placeholder="Ask a question about this symbol..." />
              <button id="btn-custom-question-submit" title="Send question">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </div>
          </div>
        </section>

        <!-- Inline Follow-Up Answers Section -->
        <section id="qa-container" class="deepwiki-qa-section" style="display: none;">
          <div class="deepwiki-qa-section-header">
            <h3>Follow-up Answers</h3>
          </div>
          <div id="qa-list"></div>
        </section>
      </div>
    </main>
  </div>

  <script nonce="${nonce}" src="${highlightUri}"></script>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
