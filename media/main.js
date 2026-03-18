// @ts-check
/* global marked */
(function () {
  const vscode = acquireVsCodeApi();

  let allProjects = [];
  let filterText = '';
  let activeFilter = 'all';
  let pinnedKeys = new Set();
  let settings = { soundEnabled: false, soundRepeatSec: 0, exportDestination: 'dialog', exportToolFormat: 'compact' };
  let previousWaitingIds = new Set();
  let soundRepeatTimer = null;
  let audioCtx = null;

  // Currently selected conversation
  let selectedSessionId = null;
  let selectedAgentId = null;
  let selectedProjectKey = null;
  let exportInProgress = false;

  // Forward declarations for later tasks (Task 3 will declare properly)
  let focusedIndex = -1;
  let layoutMode = 'wide';
  let renderedMessageCount = 0;
  function deactivateLiveIndicator() {}

  // Tailing state
  let liveTimeout = null;
  let isUserAtBottom = true;

  // Keyboard navigation state
  let sidebarHasFocus = false;
  let lastGPress = 0;
  let helpOverlayVisible = false;

  // Scroll tracking for conversation container
  const convContainerEl = document.getElementById('conversation-container');
  if (convContainerEl) {
    convContainerEl.addEventListener('scroll', function () {
      const threshold = 50;
      isUserAtBottom = (this.scrollHeight - this.scrollTop - this.clientHeight) < threshold;
      if (isUserAtBottom) {
        const pill = document.getElementById('new-msg-pill');
        if (pill) pill.remove();
        const div = document.querySelector('.new-msg-divider');
        if (div) div.remove();
      }
    });
  }

  // Restore webview-local state
  const saved = vscode.getState();
  if (saved) {
    activeFilter = saved.activeFilter || 'all';
    filterText = saved.filterText || '';
  }

  // ── Message from extension ──────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'update') {
      allProjects = msg.projects ?? [];
      if (msg.pinnedKeys) pinnedKeys = new Set(msg.pinnedKeys);
      if (msg.settings) {
        settings = msg.settings;
        syncSettingsUI();
      }
      renderSidebar(filtered());
      checkWaitingAndNotify();
      document.getElementById('last-updated').textContent =
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (msg.command === 'conversation') {
      renderConversation(msg.messages, msg.sessionId, msg.agentId);
    }
    if (msg.command === 'exportDone') {
      exportInProgress = false;
      exportBtn.disabled = false;
    }
  });

  // ── Toolbar ──────────────────────────────────────────────────────────────────
  document.getElementById('refresh-btn').addEventListener('click', () => {
    document.getElementById('last-updated').textContent = '…';
    vscode.postMessage({ command: 'refresh' });
  });

  // ── Search ───────────────────────────────────────────────────────────────────
  const searchInput = document.getElementById('search');
  const clearBtn = document.getElementById('clear-search');

  if (filterText) {
    searchInput.value = filterText;
    clearBtn.style.display = 'flex';
  }

  searchInput.addEventListener('input', (e) => {
    filterText = e.target.value.toLowerCase();
    clearBtn.style.display = filterText ? 'flex' : 'none';
    renderSidebar(filtered());
    saveState();
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    filterText = '';
    clearBtn.style.display = 'none';
    renderSidebar(filtered());
    searchInput.focus();
    saveState();
  });

  // ── Filter bar ─────────────────────────────────────────────────────────────
  const filterBar = document.getElementById('filter-bar');

  filterBar.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.classList.toggle('selected', chip.dataset.filter === activeFilter);
  });

  filterBar.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    activeFilter = chip.dataset.filter;
    filterBar.querySelectorAll('.filter-chip').forEach((c) => {
      c.classList.toggle('selected', c.dataset.filter === activeFilter);
    });
    renderSidebar(filtered());
    saveState();
  });

  // ── Export button ──────────────────────────────────────────────────────────
  const exportBtn = document.getElementById('export-btn');

  exportBtn.addEventListener('click', () => {
    if (exportInProgress || !selectedSessionId || !selectedProjectKey) return;
    exportInProgress = true;
    exportBtn.disabled = true;
    vscode.postMessage({ command: 'exportChat', projectKey: selectedProjectKey, sessionId: selectedSessionId });
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const soundEnabledCb = document.getElementById('sound-enabled');
  const soundRepeatSel = document.getElementById('sound-repeat');
  const testSoundBtn = document.getElementById('test-sound-btn');

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.settings-wrap')) {
      settingsPanel.classList.remove('open');
    }
  });

  soundEnabledCb.addEventListener('change', () => {
    settings.soundEnabled = soundEnabledCb.checked;
    pushSettings();
  });

  soundRepeatSel.addEventListener('change', () => {
    settings.soundRepeatSec = Number.parseInt(soundRepeatSel.value, 10);
    pushSettings();
    resetRepeatTimer();
  });

  testSoundBtn.addEventListener('click', () => {
    playNotificationSound();
  });

  document.querySelectorAll('input[name="export-dest"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      settings.exportDestination = radio.value;
      pushSettings();
    });
  });

  document.querySelectorAll('input[name="export-tool"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      settings.exportToolFormat = radio.value;
      pushSettings();
    });
  });

  function syncSettingsUI() {
    soundEnabledCb.checked = settings.soundEnabled;
    soundRepeatSel.value = String(settings.soundRepeatSec);
    const destRadio = document.querySelector(`input[name="export-dest"][value="${settings.exportDestination || 'dialog'}"]`);
    if (destRadio) destRadio.checked = true;
    const toolRadio = document.querySelector(`input[name="export-tool"][value="${settings.exportToolFormat || 'compact'}"]`);
    if (toolRadio) toolRadio.checked = true;
  }

  function pushSettings() {
    vscode.postMessage({ command: 'updateSettings', settings });
  }

  // ── State persistence ──────────────────────────────────────────────────────
  function saveState() {
    vscode.setState({ activeFilter, filterText });
  }

  // ── Sound system ───────────────────────────────────────────────────────────
  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function playNotificationSound() {
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = 880;
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc1.start(now);
      osc1.stop(now + 0.15);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = 1175;
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      gain2.gain.setValueAtTime(0.15, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.35);
    } catch (_) {
      // Audio API unavailable
    }
  }

  // ── Waiting detection ──────────────────────────────────────────────────────
  function isItemWaiting(item) {
    if (!item.lastTimestamp) return false;
    const mins = (Date.now() - new Date(item.lastTimestamp).getTime()) / 60000;
    return mins < 5 && item.lastMessageRole === 'assistant';
  }

  function isProjectWaiting(project) {
    return project.sessions.some(
      (s) => isItemWaiting(s) || s.subAgents.some((a) => isItemWaiting(a))
    );
  }

  function isProjectActive(project) {
    if (!project.lastActivity) return false;
    return (Date.now() - new Date(project.lastActivity).getTime()) < 5 * 60 * 1000;
  }

  function checkWaitingAndNotify() {
    const waitingIds = new Set();
    for (const p of allProjects) {
      for (const s of p.sessions) {
        if (isItemWaiting(s)) waitingIds.add(s.sessionId);
        for (const a of s.subAgents) {
          if (isItemWaiting(a)) waitingIds.add(a.agentId);
        }
      }
    }
    const hasNew = [...waitingIds].some((id) => !previousWaitingIds.has(id));
    if (hasNew && settings.soundEnabled) {
      playNotificationSound();
    }
    previousWaitingIds = waitingIds;
    resetRepeatTimer();
  }

  function resetRepeatTimer() {
    if (soundRepeatTimer) {
      clearInterval(soundRepeatTimer);
      soundRepeatTimer = null;
    }
    if (previousWaitingIds.size > 0 && settings.soundEnabled && settings.soundRepeatSec > 0) {
      soundRepeatTimer = setInterval(() => {
        const stillWaiting = allProjects.some((p) => isProjectWaiting(p));
        if (stillWaiting) {
          playNotificationSound();
        } else {
          clearInterval(soundRepeatTimer);
          soundRepeatTimer = null;
        }
      }, settings.soundRepeatSec * 1000);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function filtered() {
    let list = allProjects;
    if (activeFilter === 'active') {
      list = list.filter((p) => isProjectActive(p));
    } else if (activeFilter === 'waiting') {
      list = list.filter((p) => isProjectWaiting(p));
    } else if (activeFilter === 'pinned') {
      list = list.filter((p) => pinnedKeys.has(p.key));
    }
    if (filterText) {
      list = list.filter(
        (p) =>
          p.displayName.toLowerCase().includes(filterText) ||
          p.path.toLowerCase().includes(filterText)
      );
    }
    if (activeFilter !== 'pinned') {
      list = [...list].sort((a, b) => {
        const ap = pinnedKeys.has(a.key) ? 1 : 0;
        const bp = pinnedKeys.has(b.key) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return 0;
      });
    }
    return list;
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const s = Math.floor(diff / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (s < 60) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function statusClass(ts, lastMessageRole) {
    if (!ts) return 'idle';
    const mins = (Date.now() - new Date(ts).getTime()) / 60000;
    if (mins < 5) {
      if (lastMessageRole === 'assistant') return 'waiting';
      return 'active';
    }
    if (mins < 120) return 'recent';
    return 'idle';
  }

  function projectStatusClass(project) {
    if (isProjectWaiting(project)) return 'waiting';
    if (!project.lastActivity) return 'idle';
    const mins = (Date.now() - new Date(project.lastActivity).getTime()) / 60000;
    if (mins < 5) return 'active';
    if (mins < 120) return 'recent';
    return 'idle';
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function trunc(str, n) {
    if (!str) return '';
    str = str.replaceAll(/\s+/g, ' ').trim();
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  // ── Sidebar Render ─────────────────────────────────────────────────────────
  function renderSidebar(projects) {
    const container = document.getElementById('projects-container');
    focusedIndex = -1; // Reset keyboard focus on re-render

    updateFilterCounts();

    if (!projects.length) {
      let msg = 'No Claude projects found.';
      if (filterText) msg = 'No projects match your filter.';
      else if (activeFilter !== 'all') msg = `No ${activeFilter} projects.`;
      container.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }

    container.innerHTML = projects.map(renderProject).join('');

    // Event delegation for project actions
    container.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        if (action === 'open') vscode.postMessage({ command: 'openFolder', path: el.dataset.path, newWindow: false });
        if (action === 'open-new') vscode.postMessage({ command: 'openFolder', path: el.dataset.path, newWindow: true });
        if (action === 'pin') vscode.postMessage({ command: 'togglePin', key: el.dataset.key });
      });
    });

    // Toggle project expand/collapse
    container.querySelectorAll('.tree-project-header').forEach((hdr) => {
      hdr.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const project = hdr.closest('.tree-project');
        if (project) project.classList.toggle('collapsed');
      });
    });

    // Click session to load conversation
    container.querySelectorAll('.tree-session').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.tree-subagent')) return;
        const key = row.dataset.projectKey;
        const sid = row.dataset.sessionId;
        if (key && sid) selectConversation(key, sid, null, row);
      });
    });

    // Click subagent to load its conversation
    container.querySelectorAll('.tree-subagent').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = row.dataset.projectKey;
        const sid = row.dataset.sessionId;
        const aid = row.dataset.agentId;
        if (key && sid && aid) selectConversation(key, sid, aid, row);
      });
    });

    applySelectedState();

    // renderIconRail is defined in Task 7 — guard for task-by-task execution
    const _renderIconRail = /** @type {any} */ (window)['renderIconRail'];
    if (layoutMode === 'narrow' && typeof _renderIconRail === 'function') _renderIconRail();
  }

  function selectConversation(projectKey, sessionId, agentId, rowEl) {
    selectedSessionId = sessionId;
    selectedAgentId = agentId;
    selectedProjectKey = projectKey;
    renderedMessageCount = 0;
    deactivateLiveIndicator();
    exportBtn.style.display = 'block';
    exportBtn.disabled = exportInProgress;

    // Remove existing pill/divider
    const pill = document.getElementById('new-msg-pill');
    if (pill) pill.remove();
    const divider = document.querySelector('.new-msg-divider');
    if (divider) divider.remove();

    // Visual selection
    document.querySelectorAll('.tree-session, .tree-subagent').forEach((r) => r.classList.remove('selected'));
    if (rowEl) rowEl.classList.add('selected');

    // Show loading in conversation panel
    const convContainer = document.getElementById('conversation-container');
    convContainer.innerHTML = '<div class="conv-loading"><div class="spinner"></div></div>';

    // Update breadcrumb
    const breadcrumb = document.getElementById('conv-breadcrumb');
    const project = allProjects.find((p) => p.key === projectKey);
    const projectName = project ? project.displayName : projectKey;
    if (agentId) {
      breadcrumb.textContent = `${projectName} / ${sessionId.slice(0, 8)}… / agent`;
    } else {
      breadcrumb.textContent = `${projectName} / ${sessionId.slice(0, 8)}…`;
    }

    vscode.postMessage({ command: 'loadConversation', projectKey, sessionId, agentId });
  }

  function applySelectedState() {
    if (!selectedSessionId) return;
    const selector = selectedAgentId
      ? `.tree-subagent[data-agent-id="${selectedAgentId}"]`
      : `.tree-session[data-session-id="${selectedSessionId}"]`;
    const el = document.querySelector(selector);
    if (el) el.classList.add('selected');
  }

  function updateFilterCounts() {
    const activeCount = allProjects.filter((p) => isProjectActive(p)).length;
    const waitingCount = allProjects.filter((p) => isProjectWaiting(p)).length;
    const pinnedCount = allProjects.filter((p) => pinnedKeys.has(p.key)).length;

    filterBar.querySelectorAll('.filter-chip').forEach((chip) => {
      const f = chip.dataset.filter;
      const badge = chip.querySelector('.filter-count');
      let count = 0;
      if (f === 'active') count = activeCount;
      else if (f === 'waiting') count = waitingCount;
      else if (f === 'pinned') count = pinnedCount;

      if (f !== 'all' && count > 0) {
        if (badge) {
          badge.textContent = count;
        } else {
          const span = document.createElement('span');
          span.className = 'filter-count';
          span.textContent = count;
          chip.appendChild(span);
        }
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // ── Project Render ─────────────────────────────────────────────────────────
  function renderProject(project) {
    const status = projectStatusClass(project);
    const isPinned = pinnedKeys.has(project.key);
    const recentSessions = project.sessions.slice(0, 8);
    const overflow = project.sessions.length - recentSessions.length;

    return `
<div class="tree-project collapsed${isPinned ? ' pinned' : ''}" data-key="${esc(project.key)}">
  <div class="tree-project-header" title="${esc(project.path)}">
    <span class="collapse-chevron"></span>
    <span class="status-dot ${status}"></span>
    <span class="tree-project-name">${esc(project.displayName)}</span>
    <span class="tree-time">${timeAgo(project.lastActivity)}</span>
    <div class="tree-project-actions">
      <button class="btn-pin${isPinned ? ' pinned' : ''}" data-action="pin" data-key="${esc(project.key)}" title="${isPinned ? 'Unpin' : 'Pin'}">&#9733;</button>
      <button class="btn-action" data-action="open" data-path="${esc(project.path)}" title="Open here">&#8594;</button>
      <button class="btn-action" data-action="open-new" data-path="${esc(project.path)}" title="New window">&#8599;</button>
    </div>
  </div>
  <div class="tree-children">
    ${recentSessions.map((s) => renderSession(s, project.key)).join('')}
    ${overflow > 0 ? `<div class="tree-overflow">+${overflow} older</div>` : ''}
  </div>
</div>`;
  }

  function renderSession(session, projectKey) {
    const status = statusClass(session.lastTimestamp, session.lastMessageRole);
    const hasAgents = session.subAgents && session.subAgents.length > 0;
    const prompt = trunc(session.firstPrompt || '(no prompt)', 60);
    const waiting = isItemWaiting(session);

    return `
<div class="tree-session${waiting ? ' waiting' : ''}"
     data-project-key="${esc(projectKey)}" data-session-id="${esc(session.sessionId)}">
  <div class="tree-session-line1">
    <span class="status-dot small ${status}"></span>
    <span class="tree-prompt">${esc(prompt)}</span>
    <span class="tree-time">${timeAgo(session.lastTimestamp)}</span>
  </div>
  <div class="tree-session-line2">
    ${waiting ? '<span class="tree-badge-waiting">waiting</span>' : ''}
    ${session.gitBranch ? `<span class="tree-branch">${esc(session.gitBranch)}</span>` : ''}
    ${session.messageCount ? `<span class="tree-msgs">${session.messageCount} msgs</span>` : ''}
    ${hasAgents ? `<span class="tree-agents">${session.subAgents.length} agent${session.subAgents.length === 1 ? '' : 's'}</span>` : ''}
  </div>
  ${hasAgents ? `<div class="tree-subagents">
    ${session.subAgents.map((a) => renderSubAgent(a, projectKey, session.sessionId)).join('')}
  </div>` : ''}
</div>`;
  }

  function renderSubAgent(agent, projectKey, sessionId) {
    const label = agent.slug || agent.agentId.slice(0, 8);
    const status = statusClass(agent.lastTimestamp, agent.lastMessageRole);
    const waiting = isItemWaiting(agent);

    return `
<div class="tree-subagent${waiting ? ' waiting' : ''}"
     data-project-key="${esc(projectKey)}" data-session-id="${esc(sessionId)}" data-agent-id="${esc(agent.agentId)}">
  <span class="status-dot tiny ${status}"></span>
  <span class="tree-agent-label">${esc(label)}</span>
  ${waiting ? '<span class="tree-badge-waiting">w</span>' : ''}
  <span class="tree-time">${timeAgo(agent.lastTimestamp)}</span>
</div>`;
  }

  // ── Conversation Render ────────────────────────────────────────────────────
  function renderConversation(messages, sessionId, agentId) {
    const container = document.getElementById('conversation-container');

    if (!messages || messages.length === 0) {
      container.innerHTML = '<div class="conv-empty"><p>No messages in this conversation.</p></div>';
      renderedMessageCount = 0;
      return;
    }

    const html = messages.map(renderMessage).join('');

    // Fade-in transition (fade out is instant clear, fade in is 150ms)
    const wrapper = document.createElement('div');
    wrapper.className = 'conv-messages conv-crossfade fading';
    wrapper.innerHTML = html;

    container.innerHTML = '';
    container.appendChild(wrapper);
    // Force reflow then remove fading class to trigger transition
    void wrapper.offsetHeight;
    wrapper.classList.remove('fading');

    // Tool badge click-to-expand
    container.querySelectorAll('.tool-badge-header').forEach((header) => {
      header.addEventListener('click', () => {
        header.closest('.tool-badge').classList.toggle('expanded');
      });
    });

    container.scrollTop = container.scrollHeight;
    renderedMessageCount = messages.length;
  }

  function renderMessage(msg) {
    const isUser = msg.role === 'user';
    const roleLabel = isUser ? 'You' : 'Claude';
    const timeStr = msg.timestamp
      ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';

    // Group consecutive tool blocks into a flex container
    let blocksHtml = '';
    let i = 0;
    while (i < msg.blocks.length) {
      const block = msg.blocks[i];
      if (block.type === 'tool') {
        let toolBadgesHtml = '';
        while (i < msg.blocks.length && msg.blocks[i].type === 'tool') {
          toolBadgesHtml += renderToolBadge(msg.blocks[i]);
          i++;
        }
        blocksHtml += `<div class="tool-badges">${toolBadgesHtml}</div>`;
      } else {
        blocksHtml += `<div class="msg-text">${formatText(block.content)}</div>`;
        i++;
      }
    }

    return `
<div class="msg ${isUser ? 'msg-user' : 'msg-assistant'}">
  <div class="msg-header">
    <span class="msg-role">${roleLabel}</span>
    <span class="msg-time">${timeStr}</span>
  </div>
  <div class="msg-body">${blocksHtml}</div>
</div>`;
  }

  function renderToolBadge(block) {
    const dotClass = block.isError ? 'error' : (block.output !== undefined ? 'success' : 'pending');
    const previewHtml = block.preview
      ? `<span class="tool-preview">${esc(trunc(block.preview, 90))}</span>`
      : '';
    const descHtml = block.description
      ? `<span class="tool-desc">${esc(trunc(block.description, 60))}</span>`
      : '';
    const inputText = block.input || '';
    const outputText = block.output || '';

    return `
<div class="tool-badge" data-tool-id="${esc(block.toolUseId || '')}">
  <div class="tool-badge-header">
    <span class="tool-dot ${dotClass}"></span>
    <span class="tool-name">${esc(block.content)}</span>
    ${previewHtml}
    ${descHtml}
  </div>
  <div class="tool-detail">
    <div class="tool-io-row">
      <span class="tool-io-label">IN</span>
      <pre class="tool-io-content${!inputText ? ' tool-io-empty' : ''}">${inputText ? esc(inputText) : '(no input)'}</pre>
    </div>
    <div class="tool-io-row">
      <span class="tool-io-label">OUT</span>
      <pre class="tool-io-content${!outputText ? ' tool-io-empty' : ''}">${outputText ? esc(trunc(outputText, 3000)) : '(no output)'}</pre>
    </div>
  </div>
</div>`;
  }

  // Configure marked for safe rendering
  const markedInstance = new marked.Marked({
    breaks: true,
    gfm: true,
  });

  function formatText(text) {
    if (!text) return '';
    try {
      return markedInstance.parse(text);
    } catch (e) {
      console.warn('Markdown parse failed, using plain text fallback', e);
      return esc(text).replaceAll('\n', '<br>');
    }
  }
})();
