import type { WebviewToExtensionMessage } from "../types.ts";
import { DEFAULT_MODEL } from "./modelList.ts";
import { applyHostMessage, getPanelStrings, initialPanelView, type PanelQa } from "./panelView.ts";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtensionMessage): void;
};

declare const marked: {
  use(options: unknown): void;
  parse(markdown: string): string;
};

declare const hljs: {
  getLanguage(lang: string): unknown;
  highlight(text: string, options: { language: string }): { value: string };
  highlightAuto(text: string): { value: string };
};

(() => {
  const vscode = acquireVsCodeApi();

  const welcomeContainer = required("welcome-container");
  const articleContainer = required("article-container");
  const skeletonLoader = required("skeleton-loader");
  const articleContent = required("article-content");
  const symbolNameEl = required("symbol-name");
  const symbolKindEl = required("symbol-kind");
  const symbolLinkEl = required("symbol-link");
  const modelBadgeEl = required("model-badge");
  const followupContainer = required("followup-container");
  const followupList = required("followup-list");
  const customQuestionInput = document.getElementById(
    "custom-question-input",
  ) as HTMLInputElement | null;
  const customQuestionBtn = document.getElementById("btn-custom-question-submit");
  const qaContainer = required("qa-container");
  const qaList = required("qa-list");
  const historySelect = document.getElementById("history-select") as HTMLSelectElement | null;
  const modelCombobox = document.getElementById("model-combobox");
  const modelTrigger = document.getElementById(
    "model-combobox-trigger",
  ) as HTMLButtonElement | null;
  const modelValueEl = document.getElementById("model-combobox-value");
  const modelDropdown = document.getElementById("model-combobox-dropdown");
  const modelInput = document.getElementById("model-combobox-input") as HTMLInputElement | null;
  const modelAddBtn = document.getElementById("model-combobox-add") as HTMLButtonElement | null;
  const modelListEl = document.getElementById("model-combobox-list");
  const refreshBtn = document.getElementById("btn-refresh");
  const copyBtn = document.getElementById("btn-copy");

  let view = initialPanelView(document.documentElement.lang === "pt-BR" ? "pt-BR" : "en");
  let renderedArticle = "";
  let followupKey = "";
  let symbolKey = "";
  let historyKey = "";
  let renderQueued = false;
  let modelDropdownOpen = false;
  let modelFilter = "";

  if (typeof marked !== "undefined") {
    marked.use({
      renderer: {
        html({ text }: { text: string }) {
          return escapeHtml(text);
        },
        code({ text, lang }: { text: string; lang?: string }) {
          let highlighted = text;
          if (typeof hljs !== "undefined") {
            if (lang && hljs.getLanguage(lang)) {
              try {
                highlighted = hljs.highlight(text, { language: lang }).value;
              } catch {
                // Keep the plain text when highlighting fails.
              }
            } else {
              try {
                highlighted = hljs.highlightAuto(text).value;
              } catch {
                // Keep the plain text when highlighting fails.
              }
            }
          }
          const langClass = lang ? `language-${lang}` : "";
          return `<pre><code class="hljs ${langClass}">${highlighted}</code></pre>`;
        },
      },
    });
  }

  window.addEventListener("message", (event) => {
    view = applyHostMessage(view, event.data);
    paint();
  });

  function paintHistory(): void {
    if (!historySelect) return;
    const strings = getPanelStrings(view.language);
    const { entries, index } = view.history;
    historySelect.hidden = entries.length === 0;
    historySelect.setAttribute("aria-label", strings.history);
    historySelect.title = strings.history;

    const nextKey = entries.map((entry) => `${entry.name}\0${entry.model}`).join("\n");
    if (nextKey !== historyKey) {
      historyKey = nextKey;
      historySelect.replaceChildren(
        ...entries.map((entry, entryIndex) => {
          const option = document.createElement("option");
          option.value = String(entryIndex);
          option.textContent = entry.model ? `${entry.name} · ${entry.model}` : entry.name;
          return option;
        }),
      );
    }

    const nextValue = index >= 0 ? String(index) : "";
    if (historySelect.value !== nextValue) historySelect.value = nextValue;
  }

  function setModelDropdownOpen(open: boolean): void {
    if (!modelDropdown || !modelTrigger) return;
    modelDropdownOpen = open;
    modelDropdown.hidden = !open;
    modelTrigger.setAttribute("aria-expanded", String(open));
    if (open) {
      modelFilter = "";
      if (modelInput) modelInput.value = "";
      paintModelList();
      modelInput?.focus();
    } else {
      modelFilter = "";
      if (modelInput) modelInput.value = "";
    }
  }

  function paintModelCombobox(): void {
    const strings = getPanelStrings(view.language);
    const { currentModel } = view.modelState;
    if (modelValueEl) modelValueEl.textContent = currentModel;
    if (modelTrigger) {
      modelTrigger.setAttribute("aria-label", strings.selectModel);
      modelTrigger.title = `${strings.selectModel}: ${currentModel}`;
    }
    if (modelInput) {
      modelInput.placeholder = strings.addModelPlaceholder;
      modelInput.setAttribute("aria-label", strings.addModelPlaceholder);
    }
    if (modelAddBtn) {
      modelAddBtn.title = strings.addModel;
      modelAddBtn.setAttribute("aria-label", strings.addModel);
    }
    if (modelListEl) {
      modelListEl.setAttribute("aria-label", strings.selectModel);
    }
    paintModelList();
  }

  function paintModelList(): void {
    if (!modelListEl) return;
    const strings = getPanelStrings(view.language);
    const { currentModel, models } = view.modelState;
    const query = modelFilter.trim();
    const lowered = query.toLowerCase();

    if (modelAddBtn) {
      modelAddBtn.disabled = !query;
    }

    const filtered = lowered ? models.filter((m) => m.toLowerCase().includes(lowered)) : models;
    const items: HTMLElement[] = [];

    for (const model of filtered) {
      const row = document.createElement("div");
      const isActive = model === currentModel;
      row.className = isActive ? "deepwiki-model-option active" : "deepwiki-model-option";

      const selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "deepwiki-model-option-btn";
      selectBtn.setAttribute("role", "option");
      selectBtn.setAttribute("aria-selected", String(isActive));
      selectBtn.title = model;

      const labelSpan = document.createElement("span");
      labelSpan.className = "deepwiki-model-option-name";
      labelSpan.textContent = model;
      selectBtn.appendChild(labelSpan);

      if (isActive) {
        const check = document.createElement("span");
        check.className = "deepwiki-model-option-check";
        check.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        selectBtn.appendChild(check);
      }

      selectBtn.addEventListener("click", () => {
        vscode.postMessage({ type: "selectModel", model });
        setModelDropdownOpen(false);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "deepwiki-model-delete-btn";
      deleteBtn.title = strings.deleteModel;
      deleteBtn.setAttribute("aria-label", `${strings.deleteModel}: ${model}`);
      deleteBtn.disabled = models.length === 1 && model === DEFAULT_MODEL;
      deleteBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        vscode.postMessage({ type: "deleteModel", model });
      });

      row.appendChild(selectBtn);
      row.appendChild(deleteBtn);
      items.push(row);
    }

    if (query && !models.includes(query)) {
      const addRow = document.createElement("button");
      addRow.type = "button";
      addRow.className = "deepwiki-model-create-row";
      addRow.textContent = `+ ${strings.addModel}: "${query}"`;
      addRow.addEventListener("click", () => {
        vscode.postMessage({ type: "addModel", model: query });
        setModelDropdownOpen(false);
      });
      items.push(addRow);
    }

    modelListEl.replaceChildren(...items);
  }

  function submitNewModel(): void {
    if (!modelInput) return;
    const model = modelInput.value.trim();
    if (!model) return;
    vscode.postMessage({ type: "addModel", model });
    setModelDropdownOpen(false);
  }

  function paint(): void {
    const strings = getPanelStrings(view.language);
    const nextSymbolKey = view.symbol ? `${view.symbol.uri}\n${view.symbol.name}` : "";
    if (nextSymbolKey !== symbolKey) {
      symbolKey = nextSymbolKey;
      if (customQuestionInput) customQuestionInput.value = "";
    }

    welcomeContainer.style.display = view.showWelcome ? "" : "none";
    articleContainer.style.display = view.showArticle ? "flex" : "none";
    skeletonLoader.style.display = view.showSkeleton ? "block" : "none";
    articleContent.style.display = view.showBody ? "block" : "none";

    // Update static strings on language change
    const welcomeTitle = document.getElementById("welcome-title");
    if (welcomeTitle) welcomeTitle.textContent = strings.welcomeTitle;
    const welcomeSubtitle = document.getElementById("welcome-subtitle");
    if (welcomeSubtitle) welcomeSubtitle.textContent = strings.welcomeSubtitle;
    const welcomeShortcutText = document.getElementById("welcome-shortcut-text");
    if (welcomeShortcutText) welcomeShortcutText.textContent = strings.welcomeShortcut;
    const welcomeHint = document.getElementById("welcome-hint");
    if (welcomeHint) welcomeHint.innerHTML = strings.welcomeRightClick;
    const followupHeading = document.getElementById("followup-heading");
    if (followupHeading) followupHeading.textContent = strings.exploreFurther;
    const qaHeading = document.getElementById("qa-heading");
    if (qaHeading) qaHeading.textContent = strings.followupAnswers;

    if (customQuestionInput) customQuestionInput.placeholder = strings.askQuestionPlaceholder;
    if (customQuestionBtn) customQuestionBtn.title = strings.sendQuestion;

    paintModelCombobox();
    paintHistory();
    if (copyBtn) copyBtn.title = strings.copyMarkdown;
    if (refreshBtn) refreshBtn.title = strings.refresh;

    symbolNameEl.textContent = view.header.name;
    symbolKindEl.textContent = view.header.kind;
    symbolLinkEl.textContent = view.header.location;

    if (view.modelBadge) {
      modelBadgeEl.textContent = view.modelBadge;
      modelBadgeEl.title = `Model: ${view.modelBadge}`;
      modelBadgeEl.style.display = "inline-flex";
    } else {
      modelBadgeEl.style.display = "none";
    }

    paintArticle();
    paintFollowups();
    resetFollowupBubbles();
    paintQas();
  }

  function resetFollowupBubbles(): void {
    const strings = getPanelStrings(view.language);
    for (const bubble of followupList.querySelectorAll(".deepwiki-question-bubble")) {
      bubble.classList.remove("loading");
      const span = bubble.querySelector("span:last-child");
      if (span?.textContent === strings.answering) span.innerHTML = strings.askInline;
    }
  }

  function paintArticle(): void {
    const strings = getPanelStrings(view.language);
    if (!view.showBody) {
      articleContent.innerHTML = "";
      renderedArticle = "";
      return;
    }
    if (view.error) {
      articleContent.innerHTML = `
        <div style="padding: 16px; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; margin: 16px 0;">
          <strong style="display: block; margin-bottom: 6px;">${escapeHtml(strings.generationError)}</strong>
          <span>${escapeHtml(view.error)}</span>
          <div style="margin-top: 12px;">
            <button id="error-retry-btn" style="padding: 4px 10px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer;">${escapeHtml(strings.retry)}</button>
          </div>
        </div>`;
      document.getElementById("error-retry-btn")?.addEventListener("click", () => {
        vscode.postMessage({ type: "refresh" });
      });
      renderedArticle = "";
      return;
    }
    if (view.streaming) {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        if (!view.streaming || view.error) return;
        writeMarkdown(articleContent, view.markdown, false);
        renderedArticle = view.markdown;
      });
      return;
    }
    if (renderedArticle !== view.markdown) {
      writeMarkdown(articleContent, view.markdown, true);
      renderedArticle = view.markdown;
    }
  }

  function paintFollowups(): void {
    const strings = getPanelStrings(view.language);
    const show = view.followups.length > 0 && !view.streaming && !view.error;
    followupContainer.style.display = show ? "block" : "none";
    if (!show) {
      if (followupKey) {
        followupList.innerHTML = "";
        followupKey = "";
      }
      return;
    }
    const key = `${view.language}\n${view.followups.join("\n")}`;
    if (key === followupKey) return;
    followupKey = key;
    followupList.innerHTML = "";
    for (const question of view.followups) {
      const bubble = document.createElement("button");
      bubble.className = "deepwiki-question-bubble";
      bubble.title = strings.askInline;
      bubble.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="margin-right: 8px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <span style="flex: 1;">${escapeHtml(question)}</span>
        <span style="font-size: 11px; opacity: 0.7; margin-left: 8px; flex-shrink: 0; color: #38bdf8; display: flex; align-items: center; gap: 3px;">${escapeHtml(strings.askInline)}</span>`;
      bubble.addEventListener("click", () => {
        bubble.classList.add("loading");
        const statusSpan = bubble.querySelector("span:last-child");
        if (statusSpan) statusSpan.textContent = strings.answering;
        vscode.postMessage({ type: "followupClick", question });
      });
      followupList.appendChild(bubble);
    }
  }

  function paintQas(): void {
    qaContainer.style.display = view.qas.length > 0 ? "block" : "none";
    const ids = new Set(view.qas.map((qa) => qa.id));
    for (const child of [...qaList.children]) {
      if (!ids.has(child.id)) child.remove();
    }
    for (const qa of view.qas) {
      let card = document.getElementById(qa.id);
      if (!card) {
        card = document.createElement("div");
        card.id = qa.id;
        card.innerHTML = qaCardHtml(qa);
        bindQaCard(card, qa.id);
        qaList.appendChild(card);
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      updateQaCard(card, qa);
    }
  }

  function qaCardHtml(qa: PanelQa): string {
    const strings = getPanelStrings(view.language);
    return `
      <div class="deepwiki-qa-card-header">
        <div class="deepwiki-qa-card-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>${escapeHtml(qa.question)}</span>
        </div>
        <div class="deepwiki-qa-card-actions">
          <span class="deepwiki-qa-model-badge">DeepWiki</span>
          <button class="deepwiki-qa-action-btn btn-copy-qa" title="${escapeHtml(strings.copy)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>${escapeHtml(strings.copy)}</span>
          </button>
          <button class="deepwiki-qa-action-btn btn-hermes-qa" title="${escapeHtml(strings.continueInHermes)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            <span>${escapeHtml(strings.hermesLabel)}</span>
          </button>
        </div>
      </div>
      <div class="deepwiki-qa-card-body">
        <div class="deepwiki-qa-loading-indicator">
          <span class="deepwiki-spinner"></span>
          <span>${escapeHtml(strings.generatingAnswer)}</span>
        </div>
        <div class="deepwiki-qa-content" style="display: none;"></div>
        <div class="deepwiki-qa-error" style="display: none;"></div>
      </div>`;
  }

  function bindQaCard(card: HTMLElement, qaId: string): void {
    card.querySelector(".btn-copy-qa")?.addEventListener("click", () => {
      const strings = getPanelStrings(view.language);
      const qa = view.qas.find((item) => item.id === qaId);
      if (!qa?.markdown) return;
      navigator.clipboard.writeText(qa.markdown);
      const span = card.querySelector(".btn-copy-qa span");
      if (span) span.textContent = strings.copied;
      setTimeout(() => {
        if (span) span.textContent = strings.copy;
      }, 1500);
    });
    card.querySelector(".btn-hermes-qa")?.addEventListener("click", () => {
      const qa = view.qas.find((item) => item.id === qaId);
      vscode.postMessage({
        type: "openInHermes",
        question: qa?.question ?? "",
        answer: qa?.markdown ?? "",
      });
    });
  }

  function updateQaCard(card: HTMLElement, qa: PanelQa): void {
    const strings = getPanelStrings(view.language);
    card.className = qa.status === "streaming" ? "deepwiki-qa-card active" : "deepwiki-qa-card";
    const content = card.querySelector(".deepwiki-qa-content") as HTMLElement | null;
    const loading = card.querySelector(".deepwiki-qa-loading-indicator") as HTMLElement | null;
    const errorEl = card.querySelector(".deepwiki-qa-error") as HTMLElement | null;
    const badge = card.querySelector(".deepwiki-qa-model-badge") as HTMLElement | null;
    if (!content || !loading || !errorEl || !badge) return;

    badge.textContent = qa.modelType ?? "DeepWiki";
    if (qa.modelType) badge.title = `Model: ${qa.modelType}`;

    if (qa.status === "error") {
      loading.style.display = "none";
      content.style.display = "none";
      errorEl.style.display = "block";
      errorEl.innerHTML = `<div style="padding: 10px 12px; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; font-size: 12px;"><strong>${escapeHtml(strings.errorPrefix)}</strong> ${escapeHtml(qa.error ?? "")}</div>`;
      return;
    }

    errorEl.style.display = "none";
    if (!qa.markdown) {
      loading.style.display = "block";
      content.style.display = "none";
      return;
    }

    loading.style.display = "none";
    content.style.display = "block";
    if (content.dataset.md !== qa.markdown) {
      writeMarkdown(content, qa.markdown, qa.status === "complete");
      content.dataset.md = qa.markdown;
    }
  }

  function writeMarkdown(el: HTMLElement, markdown: string, enhance: boolean): void {
    if (typeof marked !== "undefined") {
      el.innerHTML = marked.parse(markdown);
      bindCitationLinks(el);
    } else {
      el.textContent = markdown;
    }
    if (enhance) enhanceCodeBlocks(el);
  }

  function bindCitationLinks(container: HTMLElement): void {
    for (const link of container.querySelectorAll("a")) {
      const href = link.getAttribute("href") || "";
      if (!href.startsWith("command:deepwiki.openFileCitation")) continue;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        try {
          const query = href.split("?")[1];
          if (!query) return;
          const decoded = JSON.parse(decodeURIComponent(query)) as [string, number?];
          vscode.postMessage({
            type: "openFileCitation",
            path: decoded[0],
            line: decoded[1] || 1,
          });
        } catch (err) {
          console.error("Failed to parse citation link", err);
        }
      });
    }
  }

  function enhanceCodeBlocks(container: HTMLElement): void {
    for (const pre of container.querySelectorAll("pre")) {
      if (pre.closest(".deepwiki-enhanced-code-block")) continue;
      const codeEl = pre.querySelector("code");
      if (!codeEl) continue;

      const codeText = codeEl.textContent || "";
      const lineCount = codeText.split("\n").length;
      const wrapper = document.createElement("div");
      wrapper.className = "deepwiki-enhanced-code-block";

      let lang = "code";
      for (const className of codeEl.className.split(" ")) {
        if (className.startsWith("language-")) {
          lang = className.replace("language-", "");
          break;
        }
      }

      const header = document.createElement("div");
      header.className = "deepwiki-enhanced-code-block-header";
      const left = document.createElement("div");
      left.className = "deepwiki-code-block-left";
      const symbol = view.symbol;
      left.innerHTML = `
        <span class="deepwiki-code-block-filename">${symbol ? symbol.relativePath : lang}</span>
        ${symbol ? `<span style="opacity: 0.6; font-size: 11px;">#${symbol.selectionRange.startLine}</span>` : ""}`;
      left.addEventListener("click", () => {
        if (!view.symbol) return;
        vscode.postMessage({
          type: "openFileLocation",
          uri: view.symbol.uri,
          line: view.symbol.selectionRange.startLine,
          column: view.symbol.selectionRange.startColumn,
        });
      });

      const copyCodeBtn = document.createElement("button");
      copyCodeBtn.className = "deepwiki-code-block-btn";
      copyCodeBtn.title = "Copy Code";
      copyCodeBtn.innerHTML = copyIcon();
      copyCodeBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(codeText);
        copyCodeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          copyCodeBtn.innerHTML = copyIcon();
        }, 1500);
      });

      const actions = document.createElement("div");
      actions.className = "deepwiki-code-block-actions";
      actions.appendChild(copyCodeBtn);
      header.appendChild(left);
      header.appendChild(actions);

      const contentDiv = document.createElement("div");
      contentDiv.className = "deepwiki-enhanced-code-block-content";
      pre.parentNode?.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(contentDiv);
      contentDiv.appendChild(pre);

      if (lineCount > 20) {
        let expanded = false;
        pre.style.maxHeight = "220px";
        pre.style.overflow = "hidden";
        const expandBtn = document.createElement("div");
        expandBtn.className = "deepwiki-code-block-expand-button";
        const hidden = lineCount - 10;
        expandBtn.textContent = `...Click to expand (${hidden} hidden lines)...`;
        expandBtn.addEventListener("click", () => {
          expanded = !expanded;
          pre.style.maxHeight = expanded ? "none" : "220px";
          pre.style.overflow = expanded ? "auto" : "hidden";
          expandBtn.textContent = expanded
            ? "Show less"
            : `...Click to expand (${hidden} hidden lines)...`;
        });
        wrapper.appendChild(expandBtn);
      }
    }
  }

  function submitCustomQuestion(): void {
    if (!customQuestionInput) return;
    const question = customQuestionInput.value.trim();
    if (!question) return;
    customQuestionInput.value = "";
    vscode.postMessage({ type: "askCustomQuestion", question });
  }

  customQuestionBtn?.addEventListener("click", submitCustomQuestion);
  customQuestionInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitCustomQuestion();
  });

  historySelect?.addEventListener("change", () => {
    const index = Number(historySelect.value);
    if (!Number.isInteger(index) || index === view.history.index) return;
    vscode.postMessage({ type: "historySelect", index });
  });

  modelTrigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    setModelDropdownOpen(!modelDropdownOpen);
  });
  modelDropdown?.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  modelInput?.addEventListener("input", () => {
    modelFilter = modelInput.value;
    paintModelList();
  });
  modelInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitNewModel();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setModelDropdownOpen(false);
      modelTrigger?.focus();
    }
  });
  modelAddBtn?.addEventListener("click", submitNewModel);
  document.addEventListener("click", (event) => {
    if (modelDropdownOpen && modelCombobox && !modelCombobox.contains(event.target as Node)) {
      setModelDropdownOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modelDropdownOpen) {
      setModelDropdownOpen(false);
      modelTrigger?.focus();
    }
  });
  refreshBtn?.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  copyBtn?.addEventListener("click", () => {
    vscode.postMessage({ type: "copyMarkdown", markdown: view.markdown });
  });
  symbolLinkEl.addEventListener("click", () => {
    if (!view.symbol) return;
    vscode.postMessage({
      type: "openFileLocation",
      uri: view.symbol.uri,
      line: view.symbol.selectionRange.startLine,
      column: view.symbol.selectionRange.startColumn,
    });
  });

  function required(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el;
  }

  function escapeHtml(text: string): string {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function copyIcon(): string {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  }

  paintModelCombobox();
  vscode.postMessage({ type: "ready" });
})();
