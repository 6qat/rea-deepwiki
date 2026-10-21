(() => {
  // @ts-expect-error
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
  const customQuestionInput = document.getElementById("custom-question-input");
  const customQuestionBtn = document.getElementById("btn-custom-question-submit");
  const qaContainer = document.getElementById("qa-container");
  const qaList = document.getElementById("qa-list");
  const backBtn = document.getElementById("btn-back");
  const forwardBtn = document.getElementById("btn-forward");
  const refreshBtn = document.getElementById("btn-refresh");
  const copyBtn = document.getElementById("btn-copy");

  let currentSymbol = null;
  let currentMarkdown = "";
  let isStreaming = false;
  const activeQAs = new Map();

  // Configure marked with highlight.js syntax highlighting
  if (typeof marked !== "undefined") {
    // @ts-expect-error
    marked.use({
      renderer: {
        // Articles quote repo code, so model output is untrusted: never let raw HTML through.
        html({ text }) {
          return escapeHtml(text);
        },
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
        },
      },
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
        activeQAs.clear();

        welcomeContainer.style.display = "none";
        articleContainer.style.display = "flex";
        skeletonLoader.style.display = "block";
        articleContent.style.display = "none";
        articleContent.innerHTML = "";
        followupContainer.style.display = "none";
        followupList.innerHTML = "";
        if (customQuestionInput) customQuestionInput.value = "";
        if (qaContainer) qaContainer.style.display = "none";
        if (qaList) qaList.innerHTML = "";

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
        scheduleRender();
        break;

      case "streamComplete":
        isStreaming = false;
        skeletonLoader.style.display = "none";
        articleContent.style.display = "block";
        currentMarkdown = msg.fullMarkdown;
        renderMarkdown(currentMarkdown);
        enhanceCodeBlocks(articleContent);

        if (msg.modelType) {
          modelBadgeEl.textContent = msg.modelType;
          modelBadgeEl.title = `Model: ${msg.modelType}`;
          modelBadgeEl.style.display = "inline-flex";
        }

        if (msg.followupQuestions && msg.followupQuestions.length > 0) {
          renderFollowupQuestions(msg.followupQuestions);
        }

        if (msg.qas && msg.qas.length > 0) {
          qaContainer.style.display = "block";
          qaList.innerHTML = "";
          msg.qas.forEach((qa) => {
            renderCompleteQaCard(qa);
          });
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

      case "qaStreamStart": {
        const qaId = msg.qaId;
        const question = msg.question;

        if (qaContainer) qaContainer.style.display = "block";

        // Reset any loading indicators on question bubbles
        const bubbles = followupList.querySelectorAll(".deepwiki-question-bubble");
        bubbles.forEach((b) => {
          b.classList.remove("loading");
          const span = b.querySelector("span:last-child");
          if (span && span.textContent === "Answering...") {
            span.innerHTML = `Ask inline &darr;`;
          }
        });

        let card = document.getElementById(qaId);
        if (!card) {
          card = document.createElement("div");
          card.id = qaId;
          card.className = "deepwiki-qa-card active";
          card.innerHTML = `
            <div class="deepwiki-qa-card-header">
              <div class="deepwiki-qa-card-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <span>${escapeHtml(question)}</span>
              </div>
              <div class="deepwiki-qa-card-actions">
                <span class="deepwiki-qa-model-badge">DeepWiki</span>
                <button class="deepwiki-qa-action-btn btn-copy-qa" title="Copy Answer">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  <span>Copy</span>
                </button>
                <button class="deepwiki-qa-action-btn btn-hermes-qa" title="Continue in Hermes Studio">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                  <span>Hermes ↗</span>
                </button>
              </div>
            </div>
            <div class="deepwiki-qa-card-body">
              <div class="deepwiki-qa-loading-indicator">
                <span class="deepwiki-spinner"></span>
                <span>Generating answer...</span>
              </div>
              <div class="deepwiki-qa-content" style="display: none;"></div>
            </div>
          `;

          const copyQaBtn = card.querySelector(".btn-copy-qa");
          const hermesQaBtn = card.querySelector(".btn-hermes-qa");

          copyQaBtn?.addEventListener("click", () => {
            const entry = activeQAs.get(qaId);
            if (entry && entry.markdown) {
              navigator.clipboard.writeText(entry.markdown);
              const span = copyQaBtn.querySelector("span");
              if (span) span.textContent = "Copied!";
              setTimeout(() => {
                if (span) span.textContent = "Copy";
              }, 1500);
            }
          });

          hermesQaBtn?.addEventListener("click", () => {
            const entry = activeQAs.get(qaId);
            vscode.postMessage({
              type: "openInHermes",
              question: question,
              answer: entry ? entry.markdown : "",
            });
          });

          qaList.appendChild(card);
        }

        activeQAs.set(qaId, {
          id: qaId,
          question,
          markdown: "",
          card,
          bodyEl: card.querySelector(".deepwiki-qa-content"),
          loadingEl: card.querySelector(".deepwiki-qa-loading-indicator"),
          badgeEl: card.querySelector(".deepwiki-qa-model-badge"),
        });

        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        break;
      }

      case "qaStreamDelta": {
        const qaId = msg.qaId;
        const entry = activeQAs.get(qaId);
        if (entry) {
          entry.markdown += msg.delta;
          if (entry.loadingEl && entry.loadingEl.style.display !== "none") {
            entry.loadingEl.style.display = "none";
            entry.bodyEl.style.display = "block";
          }
          if (typeof marked !== "undefined") {
            entry.bodyEl.innerHTML = marked.parse(entry.markdown);
            bindCitationLinks(entry.bodyEl);
          } else {
            entry.bodyEl.textContent = entry.markdown;
          }
        }
        break;
      }

      case "qaStreamComplete": {
        const qaId = msg.qaId;
        const entry = activeQAs.get(qaId);
        if (entry) {
          entry.markdown = msg.fullMarkdown;
          if (entry.loadingEl) entry.loadingEl.style.display = "none";
          entry.bodyEl.style.display = "block";
          if (typeof marked !== "undefined") {
            entry.bodyEl.innerHTML = marked.parse(entry.markdown);
            bindCitationLinks(entry.bodyEl);
          } else {
            entry.bodyEl.textContent = entry.markdown;
          }
          if (msg.modelType && entry.badgeEl) {
            entry.badgeEl.textContent = msg.modelType;
            entry.badgeEl.title = `Model: ${msg.modelType}`;
          }
          enhanceCodeBlocks(entry.card);
          entry.card.classList.remove("active");
        }
        break;
      }

      case "qaStreamError": {
        const qaId = msg.qaId;
        const entry = activeQAs.get(qaId);
        if (entry) {
          if (entry.loadingEl) entry.loadingEl.style.display = "none";
          entry.bodyEl.style.display = "block";
          entry.bodyEl.innerHTML = `
            <div style="padding: 10px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 12px;">
              <strong>Error:</strong> ${escapeHtml(msg.message)}
            </div>
          `;
          entry.card.classList.remove("active");
        }
        break;
      }

      case "setHistoryState":
        if (backBtn) backBtn.disabled = !msg.hasBack;
        if (forwardBtn) forwardBtn.disabled = !msg.hasForward;
        break;
    }
  });

  // One render per frame: re-parsing and re-highlighting on every token freezes the panel.
  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      // streamComplete already rendered and enhanced the final text; a late render would undo it.
      if (isStreaming) renderMarkdown(currentMarkdown);
    });
  }

  function renderMarkdown(md) {
    if (typeof marked !== "undefined") {
      // @ts-expect-error
      articleContent.innerHTML = marked.parse(md);
      bindCitationLinks(articleContent);
    } else {
      articleContent.textContent = md;
    }
  }

  function bindCitationLinks(container) {
    const root = container || articleContent;
    const links = root.querySelectorAll("a");
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

  function enhanceCodeBlocks(container) {
    const root = container || articleContent;
    const preBlocks = root.querySelectorAll("pre");
    preBlocks.forEach((pre) => {
      if (pre.closest(".deepwiki-enhanced-code-block")) return;

      const codeEl = pre.querySelector("code");
      if (!codeEl) return;

      const codeText = codeEl.textContent || "";
      const lines = codeText.split("\n");
      const lineCount = lines.length;

      const wrapper = document.createElement("div");
      wrapper.className = "deepwiki-enhanced-code-block";

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

      if (lineCount > 20) {
        let isExpanded = false;
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
      bubble.title = "Ask question inline";
      bubble.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="margin-right: 8px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <span style="flex: 1;">${escapeHtml(q)}</span>
        <span style="font-size: 11px; opacity: 0.7; margin-left: 8px; flex-shrink: 0; color: #38bdf8; display: flex; align-items: center; gap: 3px;">Ask inline &darr;</span>
      `;
      bubble.addEventListener("click", () => {
        bubble.classList.add("loading");
        const statusSpan = bubble.querySelector("span:last-child");
        if (statusSpan) statusSpan.textContent = "Answering...";
        vscode.postMessage({
          type: "followupClick",
          question: q,
        });
      });
      followupList.appendChild(bubble);
    });
    followupContainer.style.display = "block";
  }

  function renderCompleteQaCard(qa) {
    const card = document.createElement("div");
    card.id = qa.id;
    card.className = "deepwiki-qa-card";
    card.innerHTML = `
      <div class="deepwiki-qa-card-header">
        <div class="deepwiki-qa-card-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>${escapeHtml(qa.question)}</span>
        </div>
        <div class="deepwiki-qa-card-actions">
          <span class="deepwiki-qa-model-badge" title="Model: ${escapeHtml(qa.modelType || "DeepWiki")}">${escapeHtml(qa.modelType || "DeepWiki")}</span>
          <button class="deepwiki-qa-action-btn btn-copy-qa" title="Copy Answer">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
          </button>
          <button class="deepwiki-qa-action-btn btn-hermes-qa" title="Continue in Hermes Studio">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            <span>Hermes ↗</span>
          </button>
        </div>
      </div>
      <div class="deepwiki-qa-card-body">
        <div class="deepwiki-qa-content">${typeof marked !== "undefined" ? marked.parse(qa.answerMarkdown) : escapeHtml(qa.answerMarkdown)}</div>
      </div>
    `;

    card.querySelector(".btn-copy-qa")?.addEventListener("click", () => {
      navigator.clipboard.writeText(qa.answerMarkdown);
      const span = card.querySelector(".btn-copy-qa span");
      if (span) span.textContent = "Copied!";
      setTimeout(() => {
        if (span) span.textContent = "Copy";
      }, 1500);
    });

    card.querySelector(".btn-hermes-qa")?.addEventListener("click", () => {
      vscode.postMessage({
        type: "openInHermes",
        question: qa.question,
        answer: qa.answerMarkdown,
      });
    });

    qaList.appendChild(card);
    activeQAs.set(qa.id, {
      id: qa.id,
      question: qa.question,
      markdown: qa.answerMarkdown,
      card,
      bodyEl: card.querySelector(".deepwiki-qa-content"),
    });

    bindCitationLinks(card);
    enhanceCodeBlocks(card);
  }

  function submitCustomQuestion() {
    if (!customQuestionInput) return;
    const q = customQuestionInput.value.trim();
    if (!q) return;
    customQuestionInput.value = "";
    vscode.postMessage({
      type: "askCustomQuestion",
      question: q,
    });
  }

  customQuestionBtn?.addEventListener("click", submitCustomQuestion);
  customQuestionInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitCustomQuestion();
    }
  });

  // Header Button Listeners
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
