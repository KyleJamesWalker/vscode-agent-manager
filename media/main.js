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
  /** @type {string | null} */
  let selectedSessionId = null;
  /** @type {string | null} */
  let selectedAgentId = null;
  /** @type {string | null} */
  let selectedProjectKey = null;
  let exportInProgress = false;
  let sendBarOpen = false;
  let sendInFlight = false;
  /** @type {string | null} */
  let currentSessionCwd = null;
  let hasLiveTerminal = false;

  // Forward declarations for later tasks (Task 3 will declare properly)
  let focusedIndex = -1;
  let layoutMode = 'wide';
  let renderedMessageCount = 0;

  // Tailing state
  /** @type {ReturnType<typeof setTimeout> | null} */
  let liveTimeout = null;
  let isUserAtBottom = true;

  // Sidebar expansion state — tracks which project keys are expanded
  /** @type {Set<string>} */
  let expandedProjectKeys = new Set();

  // Keyboard navigation state
  let sidebarHasFocus = true;
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

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      const newMode = width > 600 ? 'wide' : 'narrow';
      if (newMode !== layoutMode) {
        layoutMode = newMode;
        applyLayoutMode();
      }
    }
  });
  const appEl = document.getElementById('app');
  if (appEl) resizeObserver.observe(appEl);

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
      currentSessionCwd = msg.cwd ?? null;
      hasLiveTerminal = false;
      const focusBtn = document.getElementById('focus-btn');
      if (focusBtn) focusBtn.style.display = 'none';
      renderConversation(msg.messages, msg.sessionId, msg.agentId);
    }
    if (msg.command === 'exportDone') {
      exportInProgress = false;
      exportBtn.disabled = false;
    }
    if (msg.command === 'conversationTail') {
      handleConversationTail(msg.messages, msg.sessionId, msg.agentId);
    }
    if (msg.command === 'sidebarRowUpdate') {
      handleSidebarRowUpdate(msg);
    }
    if (msg.command === 'terminalStatus') {
      if (msg.cwd === currentSessionCwd) {
        hasLiveTerminal = msg.hasTerminal;
        const focusBtn = document.getElementById('focus-btn');
        if (focusBtn) focusBtn.style.display = hasLiveTerminal ? 'inline-block' : 'none';
      }
    }
    if (msg.command === 'sendMessageResult') {
      sendInFlight = false;
      const submitBtn = document.getElementById('send-submit-btn');
      const input = document.getElementById('send-input');
      const errorEl = document.getElementById('send-error');
      if (msg.success) {
        if (input) { input.value = ''; input.style.height = ''; }
        if (submitBtn) { submitBtn.textContent = 'Send'; submitBtn.disabled = true; }
        if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('visible'); }
      } else {
        if (input) input.disabled = false;
        if (submitBtn) { submitBtn.textContent = 'Send'; submitBtn.disabled = false; }
        if (errorEl) { errorEl.textContent = msg.error || 'Send failed'; errorEl.classList.add('visible'); }
      }
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

  const focusBtnEl = document.getElementById('focus-btn');
  if (focusBtnEl) {
    focusBtnEl.addEventListener('click', () => {
      vscode.postMessage({ command: 'focusTerminal' });
    });
  }

  const sendBtnEl = document.getElementById('send-btn');
  if (sendBtnEl) {
    sendBtnEl.addEventListener('click', () => {
      if (sendBarOpen) {
        closeSendBar();
      } else {
        openSendBar();
      }
    });
  }

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
    return mins < 5 && item.status === 'waiting';
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

  function statusClass(ts, precomputedStatus) {
    if (!ts) return 'idle';
    const mins = (Date.now() - new Date(ts).getTime()) / 60000;
    if (mins < 5) {
      if (precomputedStatus === 'thinking') return 'thinking';
      if (precomputedStatus === 'waiting') return 'waiting';
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

  // ── Responsive layout ──────────────────────────────────────────────────────
  function applyLayoutMode() {
    const iconRail = document.getElementById('icon-rail');
    const app = document.getElementById('app');
    if (!app || !iconRail) return;

    if (layoutMode === 'narrow') {
      app.classList.add('narrow-mode');
      iconRail.style.display = 'flex';
      renderIconRail();
    } else {
      app.classList.remove('narrow-mode');
      iconRail.style.display = 'none';
      closeSidebarOverlay();
    }
  }

  function renderIconRail() {
    const rail = document.getElementById('icon-rail');
    if (!rail) return;
    const projects = filtered();
    rail.innerHTML = projects.map((p) => {
      const status = projectStatusClass(p);
      return `<div class="icon-rail-dot ${status}" data-key="${esc(p.key)}" title="${esc(p.displayName)} (${p.sessions.length} sessions)"></div>`;
    }).join('');
    rail.querySelectorAll('.icon-rail-dot').forEach((dot) => {
      dot.addEventListener('click', () => { openSidebarOverlay(); });
    });
  }

  function openSidebarOverlay() {
    closeSidebarOverlay();

    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-overlay-backdrop';
    backdrop.addEventListener('click', () => closeSidebarOverlay());

    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';

    // Build overlay content — a minimal sidebar with just the project list
    overlay.innerHTML = `
      <div class="sidebar-header">
        <span class="sidebar-title">Agent Manager</span>
      </div>
      <div id="overlay-projects-container" style="flex:1;overflow-y:auto;padding:2px 0;"></div>
    `;

    const appEl2 = document.getElementById('app');
    if (appEl2) {
      appEl2.appendChild(backdrop);
      appEl2.appendChild(overlay);
    }

    // Render projects into overlay container
    const container = document.getElementById('overlay-projects-container');
    const projects = filtered();
    if (container && projects.length) {
      container.innerHTML = projects.map(renderProject).join('');
      bindSidebarEvents(container, true);
    } else if (container) {
      container.innerHTML = '<div class="empty">No projects</div>';
    }

    // Trigger slide-in animation
    void overlay.offsetHeight;
    overlay.classList.add('open');
  }

  function closeSidebarOverlay() {
    const backdrop = document.querySelector('.sidebar-overlay-backdrop');
    const overlay = document.getElementById('sidebar-overlay');
    if (backdrop) backdrop.remove();
    if (overlay) overlay.remove();
  }

  /**
   * Bind click events for sidebar content. Used by both main sidebar and overlay.
   * @param {HTMLElement} container
   * @param {boolean} closeOverlayOnSelect
   */
  function bindSidebarEvents(container, closeOverlayOnSelect) {
    container.querySelectorAll('[data-action]').forEach((el) => {
      const elTyped = /** @type {HTMLElement} */ (el);
      elTyped.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = elTyped.dataset.action;
        if (action === 'open') vscode.postMessage({ command: 'openFolder', path: elTyped.dataset.path });
        if (action === 'pin') vscode.postMessage({ command: 'togglePin', key: elTyped.dataset.key });
      });
    });

    container.querySelectorAll('.tree-project-header').forEach((hdr) => {
      hdr.addEventListener('click', (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('[data-action]')) return;
        const proj = hdr.closest('.tree-project');
        proj.classList.toggle('collapsed');
        const key = proj.dataset.key;
        if (key) {
          if (proj.classList.contains('collapsed')) expandedProjectKeys.delete(key);
          else expandedProjectKeys.add(key);
        }
        // Sync keyboard focus index to clicked project header
        const items = getFlatNavigationList();
        const idx = items.findIndex((item) => item.el === hdr);
        if (idx >= 0) focusedIndex = idx;
      });
    });

    container.querySelectorAll('.tree-session').forEach((row) => {
      const rowTyped = /** @type {HTMLElement} */ (row);
      rowTyped.addEventListener('click', (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('.tree-subagent')) return;
        const key = rowTyped.dataset.projectKey;
        const sid = rowTyped.dataset.sessionId;
        if (key && sid) {
          selectConversation(key, sid, null, rowTyped);
          if (closeOverlayOnSelect) closeSidebarOverlay();
        }
      });
    });

    container.querySelectorAll('.tree-subagent').forEach((row) => {
      const rowTyped = /** @type {HTMLElement} */ (row);
      rowTyped.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = rowTyped.dataset.projectKey;
        const sid = rowTyped.dataset.sessionId;
        const aid = rowTyped.dataset.agentId;
        if (key && sid && aid) {
          selectConversation(key, sid, aid, rowTyped);
          if (closeOverlayOnSelect) closeSidebarOverlay();
        }
      });
    });
  }

  // ── Sidebar Render ─────────────────────────────────────────────────────────
  function renderSidebar(projects) {
    const container = document.getElementById('projects-container');
    focusedIndex = -1; // Reset keyboard focus on re-render

    // Snapshot which projects are currently expanded before replacing DOM
    container.querySelectorAll('.tree-project:not(.collapsed)').forEach((el) => {
      const key = el.dataset.key;
      if (key) expandedProjectKeys.add(key);
    });
    container.querySelectorAll('.tree-project.collapsed').forEach((el) => {
      const key = el.dataset.key;
      if (key) expandedProjectKeys.delete(key);
    });

    updateFilterCounts();

    if (!projects.length) {
      let msg = 'No Claude projects found.';
      if (filterText) msg = 'No projects match your filter.';
      else if (activeFilter !== 'all') msg = `No ${activeFilter} projects.`;
      container.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }

    container.innerHTML = projects.map(renderProject).join('');

    if (container) bindSidebarEvents(container, false);
    applySelectedState();

    if (layoutMode === 'narrow' && typeof renderIconRail === 'function') renderIconRail();
  }

  function selectConversation(projectKey, sessionId, agentId, rowEl) {
    selectedSessionId = sessionId;
    selectedAgentId = agentId;
    selectedProjectKey = projectKey;
    renderedMessageCount = 0;
    deactivateLiveIndicator();
    exportBtn.style.display = 'block';
    exportBtn.disabled = exportInProgress;
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) sendBtn.style.display = 'inline-block';
    const focusBtn2 = document.getElementById('focus-btn');
    if (focusBtn2) focusBtn2.style.display = 'none'; // hidden until terminalStatus arrives
    closeSendBar();

    // Remove existing pill/divider
    const pill = document.getElementById('new-msg-pill');
    if (pill) pill.remove();
    const divider = document.querySelector('.new-msg-divider');
    if (divider) divider.remove();

    // Visual selection
    document.querySelectorAll('.tree-session, .tree-subagent').forEach((r) => r.classList.remove('selected'));
    if (rowEl) rowEl.classList.add('selected');

    // Sync keyboard focus index to clicked row so j/k continues from here
    if (rowEl) {
      const items = getFlatNavigationList();
      const idx = items.findIndex((item) => item.el === rowEl);
      if (idx >= 0) focusedIndex = idx;
    }

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
      ? `.tree-subagent[data-agent-id="${CSS.escape(selectedAgentId)}"]`
      : `.tree-session[data-session-id="${CSS.escape(selectedSessionId)}"]`;
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

    const isCollapsed = !expandedProjectKeys.has(project.key);

    return `
<div class="tree-project${isCollapsed ? ' collapsed' : ''}${isPinned ? ' pinned' : ''}" data-key="${esc(project.key)}">
  <div class="tree-project-header" title="${esc(project.path)}">
    <span class="collapse-chevron"></span>
    <span class="status-dot ${status}"></span>
    <span class="tree-project-name">${esc(project.displayName)}</span>
    <span class="tree-time">${timeAgo(project.lastActivity)}</span>
    <div class="tree-project-actions">
      <button class="btn-pin${isPinned ? ' pinned' : ''}" data-action="pin" data-key="${esc(project.key)}" title="${isPinned ? 'Unpin' : 'Pin'}">&#9733;</button>
      <button class="btn-action" data-action="open" data-path="${esc(project.path)}" title="Open project">&#8594;</button>
    </div>
  </div>
  <div class="tree-children">
    ${recentSessions.map((s) => renderSession(s, project.key)).join('')}
    ${overflow > 0 ? `<div class="tree-overflow">+${overflow} older</div>` : ''}
  </div>
</div>`;
  }

  function renderSession(session, projectKey) {
    const status = statusClass(session.lastTimestamp, session.status);
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
    const status = statusClass(agent.lastTimestamp, agent.status);
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

  // ── Live indicator ─────────────────────────────────────────────────────────
  function activateLiveIndicator() {
    const indicator = document.getElementById('live-indicator');
    if (indicator) indicator.classList.add('active');
    if (liveTimeout) clearTimeout(liveTimeout);
    liveTimeout = setTimeout(() => { deactivateLiveIndicator(); }, 60000);
  }

  function deactivateLiveIndicator() {
    const indicator = document.getElementById('live-indicator');
    if (indicator) indicator.classList.remove('active');
    if (liveTimeout) { clearTimeout(liveTimeout); liveTimeout = null; }
  }

  function openSendBar() {
    sendBarOpen = true;
    const bar = document.getElementById('send-bar');
    if (bar) bar.classList.add('open');
    const input = document.getElementById('send-input');
    if (input) { input.disabled = false; input.focus(); }
  }

  function closeSendBar() {
    sendBarOpen = false;
    const bar = document.getElementById('send-bar');
    if (bar) bar.classList.remove('open');
    const input = document.getElementById('send-input');
    if (input) { input.value = ''; input.style.height = ''; input.disabled = false; }
    const submitBtn = document.getElementById('send-submit-btn');
    if (submitBtn) { submitBtn.textContent = 'Send'; submitBtn.disabled = true; }
    const errorEl = document.getElementById('send-error');
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('visible'); }
    sendInFlight = false;
  }

  function submitSendBar() {
    const input = document.getElementById('send-input');
    if (!input || !input.value.trim() || sendInFlight) return;
    sendInFlight = true;
    const text = input.value;
    const submitBtn = document.getElementById('send-submit-btn');
    const errorEl = document.getElementById('send-error');
    const isResuming = !hasLiveTerminal;

    input.disabled = true;
    if (submitBtn) submitBtn.textContent = isResuming ? 'Resuming…' : '…';
    if (submitBtn) submitBtn.disabled = true;
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('visible'); }

    vscode.postMessage({ command: 'sendMessage', text });
  }

  // ── Send bar textarea event listeners ─────────────────────────────────────
  const sendInputEl = document.getElementById('send-input');
  if (sendInputEl) {
    sendInputEl.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 88) + 'px';
      const submitBtn = document.getElementById('send-submit-btn');
      if (submitBtn) submitBtn.disabled = !this.value.trim() || sendInFlight;
    });

    sendInputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitSendBar();
      }
      if (e.key === 'Escape') {
        e.stopPropagation(); // prevent global Escape from deselecting session
        closeSendBar();
      }
    });
  }

  const sendSubmitBtnEl = document.getElementById('send-submit-btn');
  if (sendSubmitBtnEl) {
    sendSubmitBtnEl.addEventListener('click', submitSendBar);
  }

  // ── Conversation tailing ───────────────────────────────────────────────────
  /**
   * @param {any[]} messages
   * @param {string} sessionId
   * @param {string | null | undefined} agentId
   */
  function handleConversationTail(messages, sessionId, agentId) {
    if (sessionId !== selectedSessionId) return;
    if ((agentId || null) !== (selectedAgentId || null)) return;
    if (!messages || messages.length === 0) return;

    const container = document.getElementById('conversation-container');
    if (!container) return;
    const convMessages = container.querySelector('.conv-messages');
    if (!convMessages) {
      renderConversation(messages, sessionId, agentId);
      return;
    }

    const newCount = messages.length;
    if (newCount <= renderedMessageCount) return;

    const newMessages = messages.slice(renderedMessageCount);
    renderedMessageCount = newCount;

    // Insert NEW divider if user is scrolled up
    if (!isUserAtBottom && !container.querySelector('.new-msg-divider')) {
      const divider = document.createElement('div');
      divider.className = 'new-msg-divider';
      divider.innerHTML = '<span>NEW</span>';
      convMessages.appendChild(divider);
    }

    // Append new messages with highlight
    for (const msg of newMessages) {
      const msgHtml = renderMessage(msg);
      const temp = document.createElement('div');
      temp.innerHTML = msgHtml;
      const msgEl = temp.firstElementChild;
      if (msgEl) {
        msgEl.classList.add('msg-new');
        convMessages.appendChild(msgEl);
        msgEl.querySelectorAll('.tool-badge-header').forEach((header) => {
          header.addEventListener('click', () => {
            header.closest('.tool-badge').classList.toggle('expanded');
          });
        });
        setTimeout(() => { msgEl.classList.add('msg-new-faded'); }, 2000);
      }
    }

    if (isUserAtBottom) {
      container.scrollTop = container.scrollHeight;
    } else {
      showNewMessagePill(newMessages.length);
    }

    activateLiveIndicator();
  }

  /** @param {number} count */
  function showNewMessagePill(count) {
    let pill = document.getElementById('new-msg-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'new-msg-pill';
      pill.className = 'new-msg-pill';
      const convCont = document.getElementById('conversation-container');
      if (convCont) convCont.appendChild(pill);
      pill.addEventListener('click', () => {
        const cont = document.getElementById('conversation-container');
        if (cont) cont.scrollTop = cont.scrollHeight;
        pill.remove();
        const d = document.querySelector('.new-msg-divider');
        if (d) d.remove();
      });
    }
    const total = parseInt(pill.dataset.count || '0', 10) + count;
    pill.dataset.count = String(total);
    pill.textContent = `${total} new message${total === 1 ? '' : 's'}`;
  }

  /** @returns {{ el: HTMLElement, type: string, projectEl?: HTMLElement }[]} */
  function getFlatNavigationList() {
    /** @type {{ el: HTMLElement, type: string, projectEl?: HTMLElement }[]} */
    const items = [];
    document.querySelectorAll('.tree-project').forEach((proj) => {
      const hdr = proj.querySelector('.tree-project-header');
      if (hdr) items.push({ el: /** @type {HTMLElement} */ (hdr), type: 'project', projectEl: /** @type {HTMLElement} */ (proj) });
      if (!proj.classList.contains('collapsed')) {
        proj.querySelectorAll('.tree-session').forEach((sess) => {
          items.push({ el: /** @type {HTMLElement} */ (sess), type: 'session' });
          sess.querySelectorAll('.tree-subagent').forEach((sub) => {
            items.push({ el: /** @type {HTMLElement} */ (sub), type: 'subagent' });
          });
        });
      }
    });
    return items;
  }

  /** @param {number} index */
  function setFocusedItem(index) {
    const items = getFlatNavigationList();
    document.querySelectorAll('.focused').forEach((el) => el.classList.remove('focused'));
    if (index < 0 || index >= items.length) { focusedIndex = -1; return; }
    focusedIndex = index;
    items[index].el.classList.add('focused');
    items[index].el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function moveFocus(delta) {
    const items = getFlatNavigationList();
    if (items.length === 0) return;
    let next = focusedIndex + delta;
    if (next < 0) next = 0;
    if (next >= items.length) next = items.length - 1;
    setFocusedItem(next);
  }

  document.addEventListener('keydown', (e) => {
    if (document.activeElement === searchInput) {
      if (e.key === 'Escape' || e.key === 'Enter') { searchInput.blur(); sidebarHasFocus = true; e.preventDefault(); }
      return;
    }
    if (helpOverlayVisible) {
      if (e.key === 'Escape') { hideHelpOverlay(); e.preventDefault(); }
      return;
    }

    const items = getFlatNavigationList();

    switch (e.key) {
      case 'j':
        e.preventDefault();
        if (!sidebarHasFocus) { const conv = document.getElementById('conversation-container'); if (conv) conv.scrollTop += 80; }
        else { moveFocus(1); }
        break;
      case 'k':
        e.preventDefault();
        if (!sidebarHasFocus) { const conv = document.getElementById('conversation-container'); if (conv) conv.scrollTop -= 80; }
        else { moveFocus(-1); }
        break;
      case 'h': {
        e.preventDefault();
        if (!sidebarHasFocus) {
          sidebarHasFocus = true;
          document.getElementById('conversation-container').classList.remove('conv-focused');
          break;
        }
        if (focusedIndex < 0 || focusedIndex >= items.length) break;
        const item = items[focusedIndex];
        if (item.type === 'project') {
          item.projectEl.classList.add('collapsed');
          const key = item.projectEl.dataset.key;
          if (key) expandedProjectKeys.delete(key);
        }
        else { for (let i = focusedIndex - 1; i >= 0; i--) { if (items[i].type === 'project') { setFocusedItem(i); break; } } }
        break;
      }
      case 'l': {
        e.preventDefault();
        if (focusedIndex < 0 || focusedIndex >= items.length) break;
        const item = items[focusedIndex];
        if (item.type === 'session' || item.type === 'subagent') {
          item.el.click();
          sidebarHasFocus = false;
          document.getElementById('conversation-container').classList.add('conv-focused');
        } else if (item.type === 'project') {
          if (item.projectEl.classList.contains('collapsed')) {
            item.projectEl.classList.remove('collapsed');
            const key = item.projectEl.dataset.key;
            if (key) expandedProjectKeys.add(key);
          }
          else { moveFocus(1); }
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (focusedIndex < 0 || focusedIndex >= items.length) break;
        const item = items[focusedIndex];
        if (item.type === 'session' || item.type === 'subagent') item.el.click();
        break;
      }
      case 'Escape': {
        e.preventDefault();
        selectedSessionId = null; selectedAgentId = null; selectedProjectKey = null;
        exportBtn.style.display = 'none';
        const sendBtn2 = document.getElementById('send-btn');
        if (sendBtn2) sendBtn2.style.display = 'none';
        const focusBtn3 = document.getElementById('focus-btn');
        if (focusBtn3) focusBtn3.style.display = 'none';
        closeSendBar();
        document.querySelectorAll('.tree-session, .tree-subagent').forEach((r) => r.classList.remove('selected'));
        document.getElementById('conversation-container').innerHTML =
          '<div class="conv-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="conv-empty-icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><p>Click on a session or agent in the sidebar to view the conversation.</p></div>';
        document.getElementById('conv-breadcrumb').textContent = 'Select a session to view its conversation';
        document.getElementById('conversation-container').classList.remove('conv-focused');
        deactivateLiveIndicator(); sidebarHasFocus = true;
        break;
      }
      case 'p': {
        e.preventDefault();
        if (focusedIndex < 0 || focusedIndex >= items.length) break;
        const projEl = items[focusedIndex].type === 'project' ? items[focusedIndex].projectEl : items[focusedIndex].el.closest('.tree-project');
        if (projEl) { const key = projEl.dataset.key; if (key) vscode.postMessage({ command: 'togglePin', key }); }
        break;
      }
      case 'g': {
        const now = Date.now();
        if (now - lastGPress < 500) {
          e.preventDefault();
          if (!sidebarHasFocus) { const conv = document.getElementById('conversation-container'); if (conv) conv.scrollTop = 0; }
          else { setFocusedItem(0); }
          lastGPress = 0;
        } else { lastGPress = now; }
        break;
      }
      case 'G':
        e.preventDefault();
        if (!sidebarHasFocus) { const conv = document.getElementById('conversation-container'); if (conv) conv.scrollTop = conv.scrollHeight; }
        else { setFocusedItem(items.length - 1); }
        break;
      case '/':
        e.preventDefault(); searchInput.focus(); searchInput.select(); sidebarHasFocus = false; break;
      case '?':
        e.preventDefault(); showHelpOverlay(); break;
      case 'Tab': {
        e.preventDefault();
        sidebarHasFocus = !sidebarHasFocus;
        const convEl = document.getElementById('conversation-container');
        if (sidebarHasFocus) {
          convEl.classList.remove('conv-focused');
        } else {
          document.querySelectorAll('.focused').forEach((el) => el.classList.remove('focused'));
          convEl.classList.add('conv-focused');
        }
        break;
      }
    }
  });

  function showHelpOverlay() {
    if (helpOverlayVisible) return;
    helpOverlayVisible = true;
    const overlay = document.createElement('div');
    overlay.className = 'help-overlay';
    overlay.innerHTML = `
    <div class="help-modal">
      <div class="help-title">Keyboard Shortcuts</div>
      <div class="help-grid">
        <div class="help-key">j / k</div><div class="help-desc">Navigate up / down</div>
        <div class="help-key">h</div><div class="help-desc">Collapse / go to parent / return to sidebar</div>
        <div class="help-key">l</div><div class="help-desc">Expand / open conversation (shifts focus right)</div>
        <div class="help-key">Enter</div><div class="help-desc">Open conversation</div>
        <div class="help-key">Escape</div><div class="help-desc">Deselect / close overlay</div>
        <div class="help-key">p</div><div class="help-desc">Toggle pin on project</div>
        <div class="help-key">g g</div><div class="help-desc">Jump to top</div>
        <div class="help-key">G</div><div class="help-desc">Jump to bottom</div>
        <div class="help-key">/</div><div class="help-desc">Focus search</div>
        <div class="help-key">?</div><div class="help-desc">This help</div>
        <div class="help-key">Tab</div><div class="help-desc">Switch sidebar / conversation</div>
      </div>
      <div class="help-dismiss">Press Escape to close</div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) hideHelpOverlay(); });
  }

  function hideHelpOverlay() {
    helpOverlayVisible = false;
    const overlay = document.querySelector('.help-overlay');
    if (overlay) overlay.remove();
  }

  /** @param {any} msg */
  function handleSidebarRowUpdate(msg) {
    // Update session row
    const row = document.querySelector(`.tree-session[data-session-id="${CSS.escape(msg.sessionId)}"]`);
    if (row) {
      const dot = row.querySelector('.status-dot');
      if (dot) dot.className = `status-dot small ${statusClass(msg.lastTimestamp, msg.status)}`;

      const isWait = isItemWaiting({ lastTimestamp: msg.lastTimestamp, status: msg.status });
      const line2 = row.querySelector('.tree-session-line2');
      if (line2) {
        const badge = line2.querySelector('.tree-badge-waiting');
        if (isWait && !badge) {
          const b = document.createElement('span');
          b.className = 'tree-badge-waiting';
          b.textContent = 'waiting';
          line2.prepend(b);
        } else if (!isWait && badge) {
          badge.remove();
        }
      }

      const msgsEl = row.querySelector('.tree-msgs');
      if (msgsEl && msg.messageCount) msgsEl.textContent = `${msg.messageCount} msgs`;
    }
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
