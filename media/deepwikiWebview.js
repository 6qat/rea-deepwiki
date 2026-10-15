(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  const welcomeContainer = document.getElementById("welcome-container");
  const articleContainer = document.getElementById("article-container");
  const skeletonLoader = document.getElementById("skeleton-loader");
  const articleContent = document.getElementById("article-content");
  const symbolHeader = document.getElementById("symbol-header");
  const symbolNameEl = document.getElementById("symbol-name");
  const symbolKindEl = document.getElementById("symbol-kind");
  const symbolLinkEl = document.getElementById("symbol-link");
  const modelBadgeEl = document.getElementById("model-badge");
  const followupContainer = document.getElementById("followup-container");
  const followupList = document.getElementById("followup-list");
  const backBtn = document.getElementById("btn-back");
  const forwardBtn = document.getElementById("btn-forward");
  const refreshBtn = document.getElementById("btn-refresh");
  const copyBtn = document.getElementById("btn-copy");

  let currentSymbol = null;
  let currentMarkdown = "";
  let isStreaming = false;

  // Configure marked with highlight.js syntax highlighting
  if (typeof marked !== "undefined") {
    // @ts-ignore
    marked.use({
      renderer: {
        code({ text, lang }) {
          let highlighted = text;
          if (typeof hljs !== "undefined") {
            if (lang && hljs.getLanguage(lang)) {
              try {
                highlighted = hljs.highlight(text, { language: lang }).value;
              } catch (e) {}
            } else {
              try {
                highlighted = hljs.highlightAuto(text).value;
              } catch (e) {}
            }
          }
          const langClass = lang ? `language-${lang}` : "";
          return `<pre><code class="hljs ${langClass}">${highlighted}</code></pre>`;
        }
      }
    });
  }

  // Handle messages from the extension host
  window.addEventListener("message", (event) => {
    const msg = event.data;

    switch (msg.type) {
      case "setSymbol":
        currentSymbol = msg.symbol;
        currentMarkdown = "";
        isStreaming = true;

        welcomeContainer.style.display = "none";
        articleContainer.style.display = "flex";
        skeletonLoader.style.display = "block";
        articleContent.style.display = "none";
        articleContent.innerHTML = "";
        followupContainer.style.display = "none";
        followupList.innerHTML = "";

        symbolNameEl.textContent = currentSymbol.name;
        symbolKindEl.textContent = currentSymbol.kind;
        symbolLinkEl.textContent = `${currentSymbol.relativePath}#${currentSymbol.selectionRange.startLine}`;
        modelBadgeEl.textContent = "DeepWiki";
        modelBadgeEl.style.display = "none";
        break;

      case "streamDelta":
        if (isStreaming) {
          skeletonLoader.style.display = "none";
          articleContent.style.display = "block";
        }
        currentMarkdown += msg.delta;
        renderMarkdown(currentMarkdown);
        break;

      case "streamComplete":
        isStreaming = false;
        skeletonLoader.style.display = "none";
        articleContent.style.display = "block";
        currentMarkdown = msg.fullMarkdown;
        renderMarkdown(currentMarkdown);
        enhanceCodeBlocks();

        if (msg.modelType) {
          modelBadgeEl.textContent = msg.modelType;
          modelBadgeEl.style.display = "inline-flex";
        }

        if (msg.followupQuestions && msg.followupQuestions.length > 0) {
          renderFollowupQuestions(msg.followupQuestions);
        }
        break;

      case "streamError":
        isStreaming = false;
        skeletonLoader.style.display = "none";
        articleContent.style.display = "block";
        articleContent.innerHTML = `
          <div style="padding: 16px; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; margin: 16px 0;">
            <strong style="display: block; margin-bottom: 6px;">DeepWiki Generation Error</strong>
            <span>${escapeHtml(msg.message)}</span>
            <div style="margin-top: 12px;">
              <button id="error-retry-btn" style="padding: 4px 10px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer;">Retry</button>
            </div>
          </div>
        `;
        document.getElementById("error-retry-btn")?.addEventListener("click", () => {
          vscode.postMessage({ type: "refresh" });
        });
        break;

      case "setHistoryState":
        if (backBtn) backBtn.disabled = !msg.hasBack;
        if (forwardBtn) forwardBtn.disabled = !msg.hasForward;
        break;
    }
  });

  function renderMarkdown(md) {
    if (typeof marked !== "undefined") {
      // @ts-ignore
      articleContent.innerHTML = marked.parse(md);
      bindCitationLinks();
    } else {
      articleContent.textContent = md;
    }
  }

  function bindCitationLinks() {
    const links = articleContent.querySelectorAll("a");
    links.forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("command:deepwiki.openFileCitation")) {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          try {
            const query = href.split("?")[1];
            if (query) {
              const decoded = JSON.parse(decodeURIComponent(query));
              const filePath = decoded[0];
              const line = decoded[1] || 1;
              vscode.postMessage({
                type: "openFileCitation",
                path: filePath,
                line: line,
              });
            }
          } catch (err) {
            console.error("Failed to parse citation link", err);
          }
        });
      }
    });
  }

  function enhanceCodeBlocks() {
    const preBlocks = articleContent.querySelectorAll("pre");
    preBlocks.forEach((pre) => {
      if (pre.closest(".deepwiki-enhanced-code-block")) return;

      const codeEl = pre.querySelector("code");
      if (!codeEl) return;

      const codeText = codeEl.textContent || "";
      const lines = codeText.split("\n");
      const lineCount = lines.length;

      const wrapper = document.createElement("div");
      wrapper.className = "deepwiki-enhanced-code-block";

      // Detect language or filename if indicated
      let lang = "code";
      const classes = codeEl.className.split(" ");
      for (const c of classes) {
        if (c.startsWith("language-")) {
          lang = c.replace("language-", "");
          break;
        }
      }

      const header = document.createElement("div");
      header.className = "deepwiki-enhanced-code-block-header";

      const left = document.createElement("div");
      left.className = "deepwiki-code-block-left";
      left.innerHTML = `
        <span class="deepwiki-code-block-filename">${currentSymbol ? currentSymbol.relativePath : lang}</span>
        ${currentSymbol ? `<span style="opacity: 0.6; font-size: 11px;">#${currentSymbol.selectionRange.startLine}</span>` : ""}
      `;
      left.addEventListener("click", () => {
        if (currentSymbol) {
          vscode.postMessage({
            type: "openFileLocation",
            uri: currentSymbol.uri,
            line: currentSymbol.selectionRange.startLine,
            column: currentSymbol.selectionRange.startColumn,
          });
        }
      });

      const actions = document.createElement("div");
      actions.className = "deepwiki-code-block-actions";

      const copyCodeBtn = document.createElement("button");
      copyCodeBtn.className = "deepwiki-code-block-btn";
      copyCodeBtn.title = "Copy Code";
      copyCodeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      copyCodeBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(codeText);
        copyCodeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          copyCodeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        }, 1500);
      });

      actions.appendChild(copyCodeBtn);
      header.appendChild(left);
      header.appendChild(actions);

      const contentDiv = document.createElement("div");
      contentDiv.className = "deepwiki-enhanced-code-block-content";

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(contentDiv);
      contentDiv.appendChild(pre);

      // Auto-collapse if lines > 20
      if (lineCount > 20) {
        let isExpanded = false;
        const originalPreStyle = pre.style.cssText;
        pre.style.maxHeight = "220px";
        pre.style.overflow = "hidden";

        const expandBtn = document.createElement("div");
        expandBtn.className = "deepwiki-code-block-expand-button";
        expandBtn.textContent = `...Click to expand (${lineCount - 10} hidden lines)...`;

        expandBtn.addEventListener("click", () => {
          isExpanded = !isExpanded;
          if (isExpanded) {
            pre.style.maxHeight = "none";
            pre.style.overflow = "auto";
            expandBtn.textContent = "Show less";
          } else {
            pre.style.maxHeight = "220px";
            pre.style.overflow = "hidden";
            expandBtn.textContent = `...Click to expand (${lineCount - 10} hidden lines)...`;
          }
        });

        wrapper.appendChild(expandBtn);
      }
    });
  }

  function renderFollowupQuestions(questions) {
    followupList.innerHTML = "";
    questions.forEach((q) => {
      const bubble = document.createElement("button");
      bubble.className = "deepwiki-question-bubble";
      bubble.title = "Open new chat in Hermes Studio";
      bubble.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="margin-right: 8px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <span style="flex: 1;">${escapeHtml(q)}</span>
        <span style="font-size: 11px; opacity: 0.65; margin-left: 8px; flex-shrink: 0; color: #38bdf8; display: flex; align-items: center; gap: 3px;">Ask Hermes &rarr;</span>
      `;
      bubble.addEventListener("click", () => {
        vscode.postMessage({
          type: "followupClick",
          question: q,
        });
      });
      followupList.appendChild(bubble);
    });
    followupContainer.style.display = "block";
  }

  // Button Listeners
  backBtn?.addEventListener("click", () => {
    vscode.postMessage({ type: "historyBack" });
  });

  forwardBtn?.addEventListener("click", () => {
    vscode.postMessage({ type: "historyForward" });
  });

  refreshBtn?.addEventListener("click", () => {
    vscode.postMessage({ type: "refresh" });
  });

  copyBtn?.addEventListener("click", () => {
    vscode.postMessage({
      type: "copyMarkdown",
      markdown: currentMarkdown,
    });
  });

  symbolLinkEl?.addEventListener("click", () => {
    if (currentSymbol) {
      vscode.postMessage({
        type: "openFileLocation",
        uri: currentSymbol.uri,
        line: currentSymbol.selectionRange.startLine,
        column: currentSymbol.selectionRange.startColumn,
      });
    }
  });

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
})();
