(function () {
  const STORAGE_KEY = "today-flow-state-v1";
  const SESSION_KEY = "today-flow-supabase-session-v1";
  const SUPABASE_URL = "https://hgmpswhitmenyvnxotff.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WW3rmZCePegJsIf6LeqFvQ_KRgHD9pz";
  const SUPABASE_TABLE = "phd_trac_records";
  const APP_VERSION = "v1.4";
  const VERSION_UPDATED_AT = "2026-06-28";
  const colors = ["#2f6f73", "#b35d4a", "#8a7b35", "#5d6f9f", "#7d5f89", "#4d7d4d", "#a55567", "#69724d"];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const todayIso = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const defaults = {
    date: todayIso(),
    activeTab: "record",
    targetScope: "day",
    reviewScope: "day",
    reviewDates: {
      day: todayIso(),
      week: todayIso(),
      month: todayIso(),
    },
    settings: {
      segments: [
        { id: "morning", name: "上午", start: "06:00", end: "12:00" },
        { id: "afternoon", name: "下午", start: "12:00", end: "18:00" },
        { id: "evening", name: "晚上", start: "18:00", end: "23:30" },
      ],
      tags: [
        { id: "study", name: "学习", color: "#2f6f73", subtags: ["专注学习", "杂事"] },
        { id: "health", name: "健康", color: "#4d7d4d", subtags: ["离座走动", "散步", "跑步"] },
        { id: "entertainment", name: "娱乐", color: "#b35d4a", subtags: ["联络", "游戏", "刷社媒"] },
      ],
      plans: ["提升文献阅读能力", "锻炼英语口语能力", "基础知识复习"],
      targetTags: ["未分类"],
      targetDefaultTag: "未分类",
      locations: { work: [], dorm: [] },
    },
    logs: {},
    locationLogs: {},
    targets: {},
    targetMigrations: {},
    habits: [],
    reviews: {},
    weeklyReviews: {},
    monthlyReviews: {},
  };

  let state = normalizeStateShape(loadState());
  let session = loadSession();
  let remoteSaveTimer = null;
  let modalCleanup = null;
  const syncMeta = {
    status: session ? "ready" : "offline",
    message: session ? "自动同步已开启" : "未登录",
    lastSyncedAt: "",
  };
  const ui = {
    editingLogs: new Set(),
    logDrafts: new Map(),
    editingLocations: new Set(),
    locationDrafts: new Map(),
    editingReviews: new Set(),
    recordEditing: false,
    targetEditing: false,
    habitEditing: false,
    reviewEditing: false,
    plansEditing: false,
    recordSummaryScope: "day",
    targetFilterTag: "__all",
    collapsedTargetTags: new Set(),
    recordSummaryMode: "task",
    reviewSummaryMode: "task",
    recordSummaryIncludeOther: false,
    reviewSummaryIncludeOther: false,
    monthReviewMode: "red",
    expandedKeyEvents: new Set(),
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaults);
      const parsed = JSON.parse(raw);
      return mergeDefaults(structuredClone(defaults), parsed);
    } catch (error) {
      console.warn(error);
      return structuredClone(defaults);
    }
  }

  function normalizeStateShape(nextState) {
    const normalized = mergeDefaults(structuredClone(defaults), nextState || {});
    normalized.targetScope = "day";
    normalized.reviewDates = {
      day: normalized.reviewDates?.day || normalized.date || todayIso(),
      week: normalized.reviewDates?.week || normalized.date || todayIso(),
      month: normalized.reviewDates?.month || normalized.date || todayIso(),
    };
    normalized.locationLogs ||= {};
    normalized.targetMigrations ||= {};
    normalized.weeklyReviews ||= {};
    normalized.monthlyReviews ||= {};
    normalized.settings.targetTags = targetTagListFromState(normalized);
    normalized.settings.targetDefaultTag = normalizedTargetDefaultTag(normalized.settings.targetDefaultTag, normalized.settings.targetTags);
    const legacyLocations = normalizeLocations(normalized.settings?.locations || {});
    const hasLocationLogs = Object.values(normalized.locationLogs).some((records) => {
      const daily = normalizeLocations(records);
      return daily.work.length || daily.dorm.length;
    });
    if (!hasLocationLogs && (legacyLocations.work.length || legacyLocations.dorm.length)) {
      normalized.locationLogs[normalized.date || todayIso()] = legacyLocations;
    }
    normalized.settings.locations = { work: [], dorm: [] };
    return normalized;
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn(error);
      return null;
    }
  }

  function mergeDefaults(base, stored) {
    if (!stored || typeof stored !== "object") return base;
    for (const key of Object.keys(stored)) {
      if (
        stored[key] &&
        typeof stored[key] === "object" &&
        !Array.isArray(stored[key]) &&
        base[key] &&
        typeof base[key] === "object" &&
        !Array.isArray(base[key])
      ) {
        base[key] = mergeDefaults(base[key], stored[key]);
      } else {
        base[key] = stored[key];
      }
    }
    return base;
  }

  function mergeCloudState(localState, remoteState) {
    const remote = normalizeStateShape(remoteState);
    const local = normalizeStateShape(localState);
    return normalizeStateShape({
      ...remote,
      date: local.date,
      activeTab: local.activeTab,
      targetScope: "day",
      reviewScope: local.reviewScope,
      reviewDates: { ...remote.reviewDates, ...local.reviewDates },
      settings: {
        ...remote.settings,
        ...local.settings,
        segments: mergeById(remote.settings.segments || [], local.settings.segments || []),
        tags: mergeById(remote.settings.tags || [], local.settings.tags || []),
        plans: mergeTextList(remote.settings.plans || [], local.settings.plans || []),
        targetTags: mergeTextList(remote.settings.targetTags || [], local.settings.targetTags || []),
        locations: { work: [], dorm: [] },
      },
      logs: mergeDateCollections(remote.logs || {}, local.logs || {}),
      locationLogs: mergeLocationLogs(remote.locationLogs || {}, local.locationLogs || {}),
      targets: mergeScopedCollections(remote.targets || {}, local.targets || {}),
      targetMigrations: { ...(remote.targetMigrations || {}), ...(local.targetMigrations || {}) },
      habits: mergeHabits(remote.habits || [], local.habits || []),
      reviews: mergeScopedCollections(remote.reviews || {}, local.reviews || {}),
      weeklyReviews: { ...(remote.weeklyReviews || {}), ...(local.weeklyReviews || {}) },
      monthlyReviews: { ...(remote.monthlyReviews || {}), ...(local.monthlyReviews || {}) },
    });
  }

  function mergeById(remoteItems, localItems) {
    const map = new Map();
    remoteItems.forEach((item) => map.set(item.id || uid(), item));
    localItems.forEach((item) => map.set(item.id || uid(), item));
    return Array.from(map.values());
  }

  function mergeTextList(remoteItems, localItems) {
    return Array.from(new Set([...remoteItems, ...localItems].filter(Boolean)));
  }

  function mergeDateCollections(remoteCollections, localCollections) {
    const result = { ...remoteCollections };
    for (const [date, items] of Object.entries(localCollections)) {
      result[date] = mergeById(result[date] || [], items || []);
    }
    return result;
  }

  function mergeScopedCollections(remoteCollections, localCollections) {
    const result = { ...remoteCollections };
    for (const [scope, collections] of Object.entries(localCollections)) {
      result[scope] ||= {};
      for (const [key, items] of Object.entries(collections || {})) {
        result[scope][key] = mergeById(result[scope][key] || [], items || []);
      }
    }
    return result;
  }

  function mergeHabits(remoteHabits, localHabits) {
    const map = new Map();
    remoteHabits.forEach((habit) => map.set(habit.id || uid(), habit));
    localHabits.forEach((habit) => {
      const existing = map.get(habit.id);
      map.set(habit.id || uid(), existing ? { ...existing, ...habit, records: { ...(existing.records || {}), ...(habit.records || {}) } } : habit);
    });
    return Array.from(map.values());
  }

  function mergeLocations(remoteLocations, localLocations) {
    const remote = normalizeLocations(remoteLocations);
    const local = normalizeLocations(localLocations);
    return {
      work: mergeById(remote.work, local.work),
      dorm: mergeById(remote.dorm, local.dorm),
    };
  }

  function mergeLocationLogs(remoteCollections, localCollections) {
    const result = { ...remoteCollections };
    for (const [date, records] of Object.entries(localCollections || {})) {
      result[date] = mergeLocationRecords(result[date] || {}, records || {});
    }
    return result;
  }

  function mergeLocationRecords(remoteLocations, localLocations) {
    const remote = normalizeLocationRecords(remoteLocations);
    const local = normalizeLocationRecords(localLocations);
    return {
      work: mergeById(remote.work, local.work),
      dorm: mergeById(remote.dorm, local.dorm),
    };
  }

  function saveState(options = {}) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (options.remote !== false) queueRemoteSave();
  }

  function setState(mutator) {
    mutator(state);
    syncTargetMigration(state, dateKey());
    saveState();
    render();
  }

  function dateKey() {
    return state.date || todayIso();
  }

  function scopeKey(scope = state.targetScope, date = dateKey()) {
    if (scope === "day") return date;
    const d = new Date(`${date}T00:00:00`);
    if (scope === "week") {
      const monday = new Date(d);
      const day = monday.getDay() || 7;
      monday.setDate(monday.getDate() - day + 1);
      return isoFromDate(monday);
    }
    return `${date.slice(0, 7)}-01`;
  }

  function isoFromDate(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function prettyScope(scope) {
    return { day: "今日", week: "本周", month: "本月" }[scope] || "今日";
  }

  function logsForDate(date = dateKey()) {
    state.logs[date] ||= [];
    return state.logs[date];
  }

  function locationRecordsForDate(date = dateKey()) {
    state.locationLogs ||= {};
    state.locationLogs[date] = normalizeLocationRecords(state.locationLogs[date] || {});
    return state.locationLogs[date];
  }

  function targetsForCurrentScope() {
    state.targets[state.targetScope] ||= {};
    const key = scopeKey(state.targetScope);
    state.targets[state.targetScope][key] ||= [];
    return state.targets[state.targetScope][key];
  }

  function reviewsForCurrentScope() {
    return reviewsForScope(state.reviewScope, reviewDate(state.reviewScope));
  }

  function reviewsForScope(scope, date = reviewDate(scope)) {
    state.reviews[scope] ||= {};
    const key = scopeKey(scope, date);
    state.reviews[scope][key] ||= [];
    state.reviews[scope][key] = state.reviews[scope][key].map(normalizeReviewItem);
    return state.reviews[scope][key];
  }

  function reviewDate(scope) {
    state.reviewDates ||= {};
    state.reviewDates[scope] ||= dateKey();
    return state.reviewDates[scope];
  }

  function render() {
    const globalDate = $("#global-date");
    const globalDatePicker = $("#global-date-picker");
    if (globalDate) globalDate.value = dateKey();
    if (globalDatePicker) globalDatePicker.value = dateKey();
    $(".date-row")?.classList.toggle("hidden", state.activeTab === "review");
    const topCurrentDate = $("#top-current-date");
    if (topCurrentDate) topCurrentDate.textContent = `${dateKey()} ${weekdayText(dateKey())}`;
    const loginButton = $("#login-button");
    if (loginButton) loginButton.textContent = session ? (syncMeta.status === "saving" ? "同步中" : "已登录") : "登录";
    $$(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.activeTab);
    });
    if (state.activeTab === "record") renderRecord();
    if (state.activeTab === "execute") renderExecute();
    if (state.activeTab === "review") renderReview();
  }

  function renderRecord() {
    const logs = logsForDate();
    const locations = locationRecordsForDate();
    $("#app").innerHTML = `
      <section class="view" data-view="record">
        <div class="section-band">
          <div class="section-title">
            <div>
              <h2>今日时间追踪</h2>
              <p class="hint">按上午、下午、晚上记录事项，可调整时间段，也可维护默认标签。</p>
            </div>
            <div class="button-row">
              ${ui.recordEditing ? `<button class="secondary-button" type="button" data-action="edit-segments">时段</button><button class="secondary-button" type="button" data-action="edit-tags">标签</button>` : ""}
              <button class="primary-button" type="button" data-action="toggle-record-edit">${ui.recordEditing ? "完成" : "编辑"}</button>
            </div>
          </div>
        </div>
        <div class="record-layout">
          ${renderLocationPanel(locations)}
          <div class="record-with-axis">
            ${renderDayAxis()}
            <div class="record-timeline-list">
              ${state.settings.segments.map((segment) => renderSegment(segment, logs)).join("")}
            </div>
          </div>
        </div>
        <section class="section-band today-summary">
          <div class="section-title compact-title">
            <div>
              <div class="summary-heading-line">
                <h2>${summaryScopeTitle(ui.recordSummaryScope)}</h2>
                ${renderRecordSummaryScopeSwitch()}
              </div>
              <p class="hint">${recordSummaryHint(ui.recordSummaryScope)}</p>
            </div>
            ${renderSummaryToggle("record", ui.recordSummaryMode)}
          </div>
          ${renderRecordSummaries()}
        </section>
      </section>
    `;
  }

  function renderDayAxis() {
    const range = recordAxisRange();
    const slices = locationSlicesForRange(range.start, range.end);
    return `
      <aside class="record-axis" aria-label="地点时间轴">
        <div class="axis-bar">
          ${slices
            .map(
              (slice) => `
                <span
                  class="axis-slice axis-${slice.type}"
                  style="height:${slice.percent}%"
                  title="${locationLabel(slice.type)} ${minutesToTime(slice.start)}-${minutesToTime(slice.end)}"
                ></span>
              `,
            )
            .join("")}
        </div>
      </aside>
    `;
  }

  function renderSegment(segment, logs) {
    const segmentLogs = logs.filter((entry) => entry.segmentId === segment.id);
    const draftLogs = [...ui.logDrafts.values()].filter((entry) => entry.date === dateKey() && entry.segmentId === segment.id);
    return `
      <section class="segment-panel" data-segment="${segment.id}">
        <div class="segment-header">
          <div class="segment-title-line">
            <h2>${escapeHtml(segment.name)}</h2>
            <span class="segment-time">${segment.start} - ${segment.end}</span>
          </div>
          <button class="icon-button" type="button" data-action="add-log" data-segment-id="${segment.id}" aria-label="新增记录">+</button>
        </div>
        <div class="entries">
          ${[...segmentLogs.map((entry) => renderLogEntry(entry, false)), ...draftLogs.map((entry) => renderLogEntry(entry, true))].join("") || `<p class="empty compact-empty">还没有记录，点右上角 +。</p>`}
        </div>
      </section>
    `;
  }

  function renderLocationPanel(locations) {
    const entries = locationEntriesForDate(dateKey(), locations);
    const drafts = [...ui.locationDrafts.values()].filter((entry) => entry.date === dateKey());
    return `
      <section class="segment-panel location-panel">
        <div class="segment-header">
          <div class="segment-title-line">
            <h2>地点时间</h2>
            <span class="segment-time">宿舍 / 工位 / 户外</span>
          </div>
          <button class="icon-button" type="button" data-action="add-location" aria-label="新增地点时间">+</button>
        </div>
        <div class="entries">
          ${[...entries.map((entry) => renderLocationEntry(entry, false)), ...drafts.map((entry) => renderLocationEntry(entry, true))].join("") || `<p class="empty compact-empty">还没有地点时间记录，点右上角 +。</p>`}
        </div>
      </section>
    `;
  }

  function renderLocationEntry(entry, isDraft = false) {
    const draft = ui.locationDrafts.get(entry.id);
    const visibleEntry = draft || entry;
    const isEditing = isDraft || ui.editingLocations.has(entry.id);
    if (!isEditing) {
      return `
        <article class="entry compact-entry location-entry" data-location-id="${entry.id}" data-location-type="${entry.type}">
          <div class="entry-display-line">
            <div class="entry-title-actions">
              <strong class="entry-tag-title">
                <i class="color-dot location-dot" style="background:${locationColor(visibleEntry.type)}"></i>
                <span>${locationLabel(visibleEntry.type)}</span>
              </strong>
              ${
                ui.recordEditing
                  ? `<div class="row-actions">
                      <button class="ghost-button compact-action" type="button" data-action="edit-location">编辑</button>
                    </div>`
                  : ""
              }
            </div>
            <span class="entry-duration">${formatLocationRange(visibleEntry)}</span>
          </div>
        </article>
      `;
    }
    return `
      <article class="entry editing-entry location-editing" data-location-id="${entry.id}" data-draft="${isDraft ? "true" : "false"}">
        <div class="entry-edit-grid">
          <select data-action="update-location" data-field="type" aria-label="地点类型">
            <option value="" ${!visibleEntry.type ? "selected" : ""}>无</option>
            <option value="work" ${visibleEntry.type === "work" ? "selected" : ""}>工位</option>
            <option value="dorm" ${visibleEntry.type === "dorm" ? "selected" : ""}>宿舍</option>
          </select>
          <div class="grid-2 tight-grid">
            <input data-action="update-location" data-field="start" type="time" value="${visibleEntry.start || ""}" aria-label="开始时间" />
            <input data-action="update-location" data-field="end" type="time" value="${visibleEntry.end || ""}" aria-label="结束时间" />
          </div>
        </div>
        <div class="log-edit-buttons">
          <button class="secondary-button" type="button" data-action="save-location">保存</button>
          ${(ui.recordEditing || isDraft) ? `<button class="danger-button" type="button" data-action="delete-location">删除</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderLogEntry(entry, isDraft = false) {
    const draft = ui.logDrafts.get(entry.id);
    const visibleEntry = draft || entry;
    const isEditing = isDraft || ui.editingLogs.has(entry.id);
    const tagOptions = state.settings.tags
      .map((tag) => `<option value="${tag.id}" ${tag.id === visibleEntry.tagId ? "selected" : ""}>${escapeHtml(tag.name)}</option>`)
      .join("");
    const tag = getTag(visibleEntry.tagId);
    const subtagOptions = (tag?.subtags || [])
      .map((subtag) => `<option value="${escapeAttr(subtag)}" ${subtag === visibleEntry.subtag ? "selected" : ""}>${escapeHtml(subtag)}</option>`)
      .join("");
    if (!isEditing) {
      return `
        <article class="entry compact-entry" data-log-id="${entry.id}">
          <div class="entry-display-line">
            <div class="entry-title-actions">
              <strong class="entry-tag-title">
                <i class="color-dot" style="background:${tag?.color || colors[0]}"></i>
                <span>${escapeHtml(tag?.name || "未分类")}${visibleEntry.subtag ? `-${escapeHtml(visibleEntry.subtag)}` : ""}</span>
              </strong>
              ${
                ui.recordEditing
                  ? `<div class="row-actions">
                      <span class="move-stack">
                        <button class="move-button" type="button" data-action="move-log" data-direction="-1" aria-label="上移">▴</button>
                        <button class="move-button" type="button" data-action="move-log" data-direction="1" aria-label="下移">▾</button>
                      </span>
                      <button class="ghost-button compact-action" type="button" data-action="edit-log">编辑</button>
                    </div>`
                  : ""
              }
            </div>
            <span class="entry-duration">${formatDuration(visibleEntry.minutes || 0)}</span>
          </div>
          ${visibleEntry.note ? `<p class="entry-note">${escapeMultiline(visibleEntry.note)}</p>` : ""}
        </article>
      `;
    }
    return `
      <article class="entry editing-entry" data-log-id="${entry.id}" data-draft="${isDraft ? "true" : "false"}">
        <div class="entry-edit-grid">
          <select data-action="update-log" data-field="tagId" aria-label="一级标签">${tagOptions}</select>
          <select data-action="update-log" data-field="subtag" aria-label="二级标签">${subtagOptions}</select>
        </div>
        <div class="entry-edit-grid single-field">
          <input data-action="update-log" data-field="minutes" type="number" min="0" step="5" value="${visibleEntry.minutes || 0}" aria-label="分钟数" />
        </div>
        <textarea rows="${textareaRows(visibleEntry.note)}" data-action="update-log" data-field="note" placeholder="可填写任务内容及描述状态">${escapeHtml(visibleEntry.note || "")}</textarea>
        <div class="log-edit-buttons">
          <button class="secondary-button" type="button" data-action="save-log">保存</button>
          <button class="danger-button" type="button" data-action="delete-log">删除</button>
        </div>
      </article>
    `;
  }

  function renderTotals(totals) {
    const entries = Object.entries(totals).filter(([, minutes]) => minutes > 0);
    if (!entries.length) return `<p class="empty">暂无已记录时长。</p>`;
    return `
      <div class="summary-list">
        ${entries
          .map(([tagId, minutes]) => {
            const tag = getTag(tagId);
            return `
              <div class="summary-pill" style="border-left-color:${tag?.color || colors[0]}">
                <strong>${escapeHtml(tag?.name || "未分类")}</strong>
                <span>${formatDuration(minutes)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderSummaryToggle(owner, mode) {
    const includeOther = owner === "review" ? ui.reviewSummaryIncludeOther : ui.recordSummaryIncludeOther;
    return `
      <div class="summary-controls">
        ${
          mode === "task"
            ? `<label class="summary-other-toggle"><input class="checkbox" type="checkbox" data-action="toggle-summary-other" data-owner="${owner}" ${includeOther ? "checked" : ""} />其他</label>`
            : ""
        }
        <div class="summary-tabs">
          <button class="toggle-button ${mode === "task" ? "active" : ""}" type="button" data-action="set-summary-mode" data-owner="${owner}" data-mode="task">任务</button>
          <button class="toggle-button ${mode === "location" ? "active" : ""}" type="button" data-action="set-summary-mode" data-owner="${owner}" data-mode="location">地点</button>
        </div>
      </div>
    `;
  }

  function renderSummaryContent(owner, scopeOverride = null, dateOverride = dateKey()) {
    const scope = scopeOverride || (owner === "review" ? state.reviewScope : "day");
    const mode = owner === "review" ? ui.reviewSummaryMode : ui.recordSummaryMode;
    const includeOther = owner === "review" ? ui.reviewSummaryIncludeOther : ui.recordSummaryIncludeOther;
    const totals = mode === "location" ? locationTotalsForScope(scope, dateOverride) : totalsForLogScope(scope, dateOverride);
    const baseline = mode === "location" || includeOther ? minutesInScope(scope) : null;
    return `
      <div class="data-summary compact-summary">
        ${renderPie(totals, baseline)}
        <div class="stat-list">${renderStatRows(totals, baseline)}</div>
      </div>
    `;
  }

  function renderRecordSummaries() {
    const scope = ui.recordSummaryScope;
    return `
      <section class="summary-scope-card active-summary-scope">
        <div class="summary-scope-title">
          <h3>${summaryScopeTitle(scope)}</h3>
          <span>${escapeHtml(scopeDisplay(scope, dateKey()))}</span>
        </div>
        ${renderSummaryContent("record", scope, dateKey())}
        <div class="stat-list habit-rate-row">
          <div class="stat-row">
            <span>习惯平均达标率</span>
            <strong>${habitRateForScope(scope, dateKey())}%</strong>
          </div>
        </div>
      </section>
    `;
  }

  function renderRecordSummaryScopeSwitch() {
    return `
      <div class="summary-scope-tabs">
        ${["day", "week", "month"]
          .map((scope) => `<button class="toggle-button ${ui.recordSummaryScope === scope ? "active" : ""}" type="button" data-action="set-record-summary-scope" data-scope="${scope}">${summaryScopeShortLabel(scope)}</button>`)
          .join("")}
      </div>
    `;
  }

  function renderPie(totals, baselineMinutes = null) {
    const recorded = sumMinutes(Object.values(totals));
    const targetTotal = Math.max(recorded, Number(baselineMinutes) || 0);
    const entries = Object.entries(totals).filter(([, minutes]) => minutes > 0);
    const otherMinutes = Math.max(0, targetTotal - recorded);
    if (otherMinutes > 0) entries.push(["__other", otherMinutes]);
    const total = targetTotal || recorded;
    if (!total) return `<div class="pie-wrap"><div class="pie" data-label="0h"></div></div>`;
    let cursor = 0;
    const parts = entries.map(([tagId, minutes], index) => {
      const start = (cursor / total) * 100;
      cursor += minutes;
      const end = (cursor / total) * 100;
      const meta = statMeta(tagId);
      const color = meta.color || colors[index % colors.length];
      return `${color} ${start}% ${end}%`;
    });
    return `<div class="pie-wrap"><div class="pie" data-label="${formatDuration(total)}" style="background: conic-gradient(${parts.join(",")})"></div></div>`;
  }

  function renderExecute() {
    state.targetScope = "day";
    const targets = targetsForCurrentScope();
    const targetTags = targetTagList(targets);
    if (ui.targetFilterTag !== "__all" && !targetTags.includes(ui.targetFilterTag)) ui.targetFilterTag = "__all";
    $("#app").innerHTML = `
      <section class="view" data-view="execute">
        ${renderTargetTagBar(targetTags)}
        <section class="section-band">
          <div class="section-title">
            <div>
              <h2>目标</h2>
              <p class="hint">${scopeDisplay(state.targetScope)}</p>
            </div>
            <div class="button-row">
              <button class="secondary-button add-button" type="button" data-action="add-target" aria-label="新增目标">+</button>
              ${ui.targetEditing ? `<button class="secondary-button" type="button" data-action="migrate-incomplete-targets">迁移</button>` : ""}
              <button class="primary-button" type="button" data-action="toggle-target-edit">${ui.targetEditing ? "完成" : "编辑"}</button>
            </div>
          </div>
          <div class="task-stack">
            ${targets.length ? renderTargetGroups(targets, targetTags) : `<p class="empty">先添加一个目标，之后可以继续拆到二级和三级任务。</p>`}
          </div>
        </section>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h2>习惯追踪</h2>
              <p class="hint">${habitTrailRangeText()}</p>
            </div>
            <div class="button-row">
              <button class="secondary-button add-button" type="button" data-action="add-habit" aria-label="新增习惯">+</button>
              <button class="primary-button" type="button" data-action="toggle-habit-edit">${ui.habitEditing ? "完成" : "编辑"}</button>
            </div>
          </div>
          <div class="habit-stack">
            ${state.habits.length ? state.habits.map(renderHabit).join("") : `<p class="empty">还没有习惯，添加一个从今天开始追踪。</p>`}
          </div>
        </section>
      </section>
    `;
  }

  function renderTargetTagBar(tags) {
    return `
      <section class="section-band target-filter-band">
        <div class="target-tag-tabs">
          <button class="target-tag-chip ${ui.targetFilterTag === "__all" ? "active" : ""}" type="button" data-action="set-target-filter" data-tag="__all">全部</button>
          ${tags.map((tag) => `<button class="target-tag-chip ${ui.targetFilterTag === tag ? "active" : ""}" type="button" data-action="set-target-filter" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</button>`).join("")}
          ${ui.targetEditing ? `<button class="secondary-button target-tag-edit-button" type="button" data-action="edit-target-tags">编辑标签</button>` : ""}
        </div>
      </section>
    `;
  }

  function renderTargetGroups(targets, tags) {
    const visibleTags = ui.targetFilterTag === "__all" ? tags : [ui.targetFilterTag];
    return visibleTags
      .map((tag) => {
        const items = targets.filter((target) => targetTag(target) === tag).sort((a, b) => Number(isTaskDone(a)) - Number(isTaskDone(b)));
        return renderTargetGroup(tag, items);
      })
      .join("");
  }

  function renderTargetGroup(tag, targets) {
    const collapsed = ui.collapsedTargetTags.has(tag);
    return `
      <section class="target-category-group ${collapsed ? "collapsed" : ""}" data-target-tag="${escapeAttr(tag)}">
        <button class="target-category-header" type="button" data-action="toggle-target-category" data-tag="${escapeAttr(tag)}" aria-label="展开或收起${escapeAttr(tag)}">
          <span>${escapeHtml(tag)}</span>
          <i>${collapsed ? "▸" : "▾"}</i>
        </button>
        ${collapsed ? "" : `<div class="target-category-list">${targets.length ? targets.map((target) => renderTarget(target)).join("") : `<p class="empty compact-empty">这个标签下还没有目标。</p>`}</div>`}
      </section>
    `;
  }

  function renderTarget(target) {
    const progress = targetProgress(target);
    const done = isTaskDone(target);
    const collapsed = target.collapsed !== false;
    return `
      <article class="task-group ${done ? "done" : ""}" data-target-id="${target.id}">
        <div class="task-header">
          <div class="task-title-wrap">
            <div class="task-title-line">
              <h3 class="task-title">
                <button class="icon-button" type="button" data-action="toggle-target" aria-label="展开或收起">${collapsed ? "▸" : "▾"}</button>
                <span>${escapeHtml(target.name)}</span>
              </h3>
              ${
                ui.targetEditing
                  ? `<div class="row-actions">
                      <span class="move-stack">
                        <button class="move-button" type="button" data-action="move-target" data-direction="-1" aria-label="上移">▴</button>
                        <button class="move-button" type="button" data-action="move-target" data-direction="1" aria-label="下移">▾</button>
                      </span>
                      <button class="secondary-button" type="button" data-action="edit-target">编辑</button>
                    </div>`
                  : ""
              }
            </div>
            <p class="task-age">执行第 ${executionDays(target) + 1} 天</p>
            ${target.description ? `<p class="task-description">${escapeMultiline(target.description)}</p>` : ""}
            ${target.hasProgress ? renderProgress(progress) : ""}
          </div>
          <div class="button-row">
            ${target.hasProgress && !target.children?.length ? renderStepper(target.id, "", target.done || 0, target.total || 1) : ""}
          </div>
        </div>
        ${collapsed ? "" : renderSubtasks(target)}
      </article>
    `;
  }

  function renderProgress(progress) {
    return `
      <div class="progress-track" aria-label="进度 ${progress.percent}%">
        <div class="progress-fill" style="width:${progress.percent}%"></div>
      </div>
      <p class="task-meta">${progress.done}/${progress.total} · ${progress.percent}%</p>
    `;
  }

  function renderSubtasks(target) {
    const children = target.children || [];
    if (!children.length) return "";
    const sorted = [...children].sort((a, b) => Number(isSubtaskDone(a)) - Number(isSubtaskDone(b)));
    return `
      <div class="subtasks">
        ${sorted.map((item) => renderSubtask(target.id, item, 2)).join("")}
      </div>
    `;
  }

  function renderSubtask(targetId, item, level) {
    const done = isSubtaskDone(item);
    return `
      <div class="subtask level-${level} ${done ? "done" : ""}" data-target-id="${targetId}" data-subtask-id="${item.id}">
        <input class="checkbox" type="checkbox" ${done ? "checked" : ""} data-action="toggle-subtask-done" aria-label="完成任务" />
        <div>
          <div class="subtask-name">${escapeHtml(item.name)}${item.hasProgress ? ` <span class="count-text">（${item.total || 1}）</span>` : ""}</div>
          ${done && item.completedAt ? `<p class="task-completed-date">${shortDateText(item.completedAt)}完成</p>` : ""}
          ${item.description ? `<p class="task-description">${escapeMultiline(item.description)}</p>` : ""}
        </div>
        <div class="task-count-controls">
          ${item.hasProgress ? renderStepper(targetId, item.id, item.done || 0, item.total || 1) : ""}
          ${
            ui.targetEditing
              ? `<span class="move-stack">
                  <button class="move-button" type="button" data-action="move-subtask" data-target-id="${targetId}" data-subtask-id="${item.id}" data-direction="-1" aria-label="上移">▴</button>
                  <button class="move-button" type="button" data-action="move-subtask" data-target-id="${targetId}" data-subtask-id="${item.id}" data-direction="1" aria-label="下移">▾</button>
                </span>`
              : ""
          }
        </div>
      </div>
      ${(item.children || []).map((child) => renderSubtask(targetId, child, 3)).join("")}
    `;
  }

  function renderStepper(targetId, subtaskId, done, total) {
    return `
      <button class="stepper-button" type="button" data-action="step-progress" data-target-id="${targetId}" data-subtask-id="${subtaskId}" data-delta="-1" aria-label="减少">−</button>
      <span class="count-text">${done}/${total}</span>
      <button class="stepper-button" type="button" data-action="step-progress" data-target-id="${targetId}" data-subtask-id="${subtaskId}" data-delta="1" aria-label="增加">+</button>
    `;
  }

  function renderScopeNavigator(scope, owner) {
    const date = dateKey();
    return `
      <div class="date-switch-panel scope-navigator" data-scope-owner="${owner}">
        <span class="date-label">${scopeSwitchLabel(scope)}</span>
        <button class="date-arrow" type="button" data-action="shift-scope-date" data-owner="${owner}" data-direction="-1" aria-label="上一个">‹</button>
        <span class="date-display-field">${escapeHtml(scopeDisplay(scope, date))}</span>
        <label class="date-calendar-button" aria-label="选择时间">
          <span aria-hidden="true">▦</span>
          <input type="${scopePickerType(scope)}" value="${escapeAttr(scopePickerValue(scope, date))}" data-action="set-scope-date" data-owner="${owner}" data-scope="${scope}" />
        </label>
        <button class="date-arrow" type="button" data-action="shift-scope-date" data-owner="${owner}" data-direction="1" aria-label="下一个">›</button>
      </div>
    `;
  }

  function renderHabit(habit) {
    const color = habit.color || colors[0];
    return `
      <article class="habit-panel" data-habit-id="${habit.id}">
        <div class="habit-row compact-habit-row">
          <div class="habit-title-line">
            <button class="icon-button small-icon" type="button" data-action="open-habit-calendar" aria-label="查看月历">▦</button>
            <h3 class="habit-name">${escapeHtml(habit.name)}</h3>
          </div>
          <div class="habit-right-line">
            <div class="habit-week">${renderHabitTrail(habit)}</div>
            ${
              ui.habitEditing
                ? `<div class="button-row">
                    <span class="move-stack">
                      <button class="move-button" type="button" data-action="move-habit" data-direction="-1" aria-label="上移">▴</button>
                      <button class="move-button" type="button" data-action="move-habit" data-direction="1" aria-label="下移">▾</button>
                    </span>
                    <button class="secondary-button" type="button" data-action="edit-habit">编辑</button>
                  </div>`
                : ""
            }
          </div>
        </div>
      </article>
    `;
  }

  function renderReview() {
    const activeScope = ["day", "week", "month"].includes(state.reviewScope) ? state.reviewScope : "day";
    state.reviewScope = activeScope;
    $("#app").innerHTML = `
      <section class="view" data-view="review">
        ${renderReviewTabs(activeScope)}
        ${renderReviewScopeSection(activeScope)}
      </section>
    `;
  }

  function renderReviewTabs(activeScope) {
    const scopes = [
      ["day", "日复盘"],
      ["week", "周复盘"],
      ["month", "月复盘"],
    ];
    return `
      <section class="section-band review-tab-panel">
        <div class="review-tabs">
          ${scopes
            .map(
              ([scope, label]) => `
                <button class="toggle-button ${activeScope === scope ? "active" : ""}" type="button" data-action="set-review-scope" data-scope="${scope}">
                  ${label}
                </button>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderReviewScopeSection(scope) {
    if (scope === "week") return renderWeeklyReviewSection();
    if (scope === "month") return renderMonthlyReviewSection();
    const date = reviewDate(scope);
    const reviewItems = reviewsForScope(scope, date);
    return `
      <section class="section-band review-scope-section" data-review-scope="${scope}">
        ${renderReviewNavigator(scope)}
        <div class="section-title">
          <div>
            <h2>${reviewLabel(scope)}</h2>
            <p class="hint">${scopeDisplay(scope, date)}</p>
          </div>
          <div class="button-row">
            <button class="secondary-button add-button" type="button" data-action="add-review-item" data-review-scope="${scope}" aria-label="新增现象">+</button>
            <button class="primary-button" type="button" data-action="toggle-review-edit">${ui.reviewEditing ? "完成" : "编辑"}</button>
          </div>
        </div>
        <div class="review-stack">
          ${reviewItems.length ? reviewItems.map((item, index) => renderReviewItem(item, index, scope)).join("") : `<p class="empty">还没有复盘事项。</p>`}
        </div>
      </section>
    `;
  }

  function renderWeeklyReviewSection() {
    const scope = "week";
    const date = reviewDate(scope);
    const key = scopeKey(scope, date);
    const review = weeklyReviewForKey(key);
    return `
      <section class="section-band review-scope-section weekly-review-section" data-review-scope="${scope}">
        ${renderReviewNavigator(scope)}
        <div class="section-title">
          <div>
            <h2>${reviewLabel(scope)}</h2>
            <p class="hint">${scopeDisplay(scope, date)}</p>
          </div>
          <div class="button-row">
            <button class="primary-button" type="button" data-action="toggle-review-edit">${ui.reviewEditing ? "完成" : "编辑"}</button>
          </div>
        </div>
        ${renderWeeklyReviewSummary(date)}
        ${renderStudyBreakdownCard(weeklyStudyBreakdown(date), "学习标签占比", "本周还没有学习记录。")}
        ${renderWeeklyKeyEvents(date)}
        ${ui.reviewEditing ? renderWeeklyReviewEditor(review, key) : renderWeeklyReviewDisplay(review)}
      </section>
    `;
  }

  function renderWeeklyReviewSummary(date) {
    const study = weeklyStudySummary(date);
    const work = weeklyWorkSummary(date);
    return `
      <div class="weekly-brief-summary">
        ${renderWeeklyBriefLine("学习时长", study.total, study.recordedDays)}
        ${renderWeeklyBriefLine("工位时长", work.total, work.recordedDays)}
      </div>
    `;
  }

  function renderWeeklyBriefLine(title, totalMinutes, recordedDays) {
    const days = Math.max(0, recordedDays || 0);
    const average = days ? totalMinutes / days : 0;
    return `<p><strong>${title}：</strong>总时长${formatHourText(totalMinutes)}/日均${formatHourText(average)}</p>`;
  }

  function renderMonthlyReviewSection() {
    const scope = "month";
    const date = reviewDate(scope);
    const key = scopeKey(scope, date);
    const review = monthlyReviewForKey(key);
    return `
      <section class="section-band review-scope-section monthly-review-section" data-review-scope="${scope}">
        ${renderReviewNavigator(scope)}
        <div class="section-title">
          <div>
            <h2>${reviewLabel(scope)}</h2>
            <p class="hint">${scopeDisplay(scope, date)}</p>
          </div>
          <div class="button-row">
            <button class="primary-button" type="button" data-action="toggle-review-edit">${ui.reviewEditing ? "完成" : "编辑"}</button>
          </div>
        </div>
        ${renderMonthlyStatsTable(date)}
        ${renderStudyBreakdownCard(monthlyStudyBreakdown(date), "学习标签占比（月）", "本月还没有学习记录。")}
        ${renderMonthlyReviewTabs()}
        ${renderMonthlyReviewPanel(review, key, date)}
      </section>
    `;
  }

  function renderStudyBreakdownCard(breakdown, title, emptyText) {
    if (!breakdown.total) {
      return `
        <section class="weekly-breakdown-card">
          <h3>${escapeHtml(title)}</h3>
          <p class="empty compact-empty">${escapeHtml(emptyText)}</p>
        </section>
      `;
    }
    return `
      <section class="weekly-breakdown-card">
        <h3>${escapeHtml(title)}</h3>
        <div class="weekly-stacked-bar" aria-label="学习标签占比">
          ${breakdown.entries
            .map((entry) => `<span style="width:${entry.percent}%;background:${entry.color}" title="${escapeAttr(entry.label)} ${entry.percent}%"></span>`)
            .join("")}
        </div>
        <div class="weekly-breakdown-legend">
          ${breakdown.entries
            .map(
              (entry) => `
                <span>
                  <i class="color-dot" style="background:${entry.color}"></i>
                  ${escapeHtml(entry.label)} ${entry.percent}%
                </span>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderMonthlyStatsTable(date) {
    const buckets = monthWeekBuckets(date);
    return `
      <section class="monthly-table-card">
        <table class="monthly-stats-table">
          <thead>
            <tr>
              <th>周次</th>
              <th>学习时长（日均）</th>
              <th>工位时长（日均）</th>
            </tr>
          </thead>
          <tbody>
            ${buckets
              .map((bucket, index) => {
                const study = studySummaryForDates(bucket.dates);
                const work = workSummaryForDates(bucket.dates);
                const studyAverage = study.recordedDays ? study.total / study.recordedDays : 0;
                const workAverage = work.recordedDays ? work.total / work.recordedDays : 0;
                return `
                  <tr>
                    <td>第${index + 1}周</td>
                    <td>${formatHourText(study.total)}（${formatHourText(studyAverage)}）</td>
                    <td>${formatHourText(work.total)}（${formatHourText(workAverage)}）</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </section>
    `;
  }

  function renderMonthlyReviewTabs() {
    const items = [
      ["red", "红灯"],
      ["green", "绿灯"],
      ["summary", "总结"],
    ];
    return `
      <div class="month-review-tabs">
        ${items
          .map(([mode, label]) => `<button class="toggle-button ${ui.monthReviewMode === mode ? "active" : ""}" type="button" data-action="set-month-review-mode" data-mode="${mode}">${label}</button>`)
          .join("")}
      </div>
    `;
  }

  function renderWeeklyKeyEvents(date) {
    const events = keyEventsForDates(datesInScope("week", date));
    return `
      <section class="monthly-key-card">
        <div class="weekly-card-title">
          <i class="weekly-icon amber"></i>
          <strong>本周关键事件</strong>
          <span>来自日复盘星标，默认只显示日期和现象，点按可展开原因和措施。</span>
        </div>
        ${
          events.length
            ? `<div class="monthly-key-list">${events.map(renderMonthlyKeyEvent).join("")}</div>`
            : `<p class="empty compact-empty">本周还没有星标关键事件。</p>`
        }
      </section>
    `;
  }

  function renderMonthlyKeyEvent(event) {
    const expanded = ui.expandedKeyEvents.has(event.key);
    return `
      <article class="monthly-key-event ${expanded ? "expanded" : ""}">
        <button class="monthly-key-event-head" type="button" data-action="toggle-key-event-detail" data-key-event-id="${escapeAttr(event.key)}">
          <span><strong>${escapeHtml(shortDateText(event.date))}</strong>${escapeHtml(event.phenomenon || "还没有写现象")}</span>
          <i>${expanded ? "▴" : "▾"}</i>
        </button>
        ${expanded ? renderMonthlyKeyEventDetails(event) : ""}
      </article>
    `;
  }

  function renderMonthlyKeyEventDetails(event) {
    if (!event.reasons.length) return `<p class="review-text monthly-key-detail">还没有写原因和措施。</p>`;
    return `
      <div class="monthly-key-detail">
        ${event.reasons
          .map(
            (reason, index) => `
              <div class="review-reason">
                <div class="entry-display-line muted-line"><span class="review-label reason-label"><i></i><strong>原因${index + 1}</strong></span></div>
                <p class="review-text">${reason.text ? escapeMultiline(reason.text) : "还没有写原因"}</p>
                ${reason.measure ? `<div class="entry-display-line muted-line"><span class="review-label measure-label"><i></i><strong>措施</strong></span></div><p class="review-text">${escapeMultiline(reason.measure)}</p>` : ""}
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderMonthlyReviewPanel(review, key, date) {
    if (ui.monthReviewMode === "summary") return renderMonthlySummaryPanel(review, key);
    const mode = ui.monthReviewMode === "green" ? "green" : "red";
    const title = mode === "red" ? "红灯情况说明" : "绿灯情况说明";
    const description =
      mode === "red"
        ? "红灯指向的是同一个事件还是多个？有没有进行针对性调整？本月核心瓶颈是什么？"
        : "这些做得好的事情有什么共同原因吗？有没有什么可复用的地方？";
    const field = mode === "red" ? "redInsight" : "greenInsight";
    return `
      ${renderMonthlyLightList(mode, date)}
      ${renderMonthlyInsightCard(mode, title, description, field, review[field], key)}
    `;
  }

  function renderMonthlyLightList(mode, date) {
    const label = mode === "red" ? "红灯" : "绿灯";
    const buckets = monthWeekBuckets(date);
    return `
      <div class="monthly-light-list">
        ${buckets
          .map((bucket, index) => {
            const weeklyReview = readWeeklyReviewForKey(bucket.key);
            const value = weeklyReview[mode] || "";
            return `
              <article class="monthly-light-item ${mode}">
                <strong>第${index + 1}周 · ${label}</strong>
                <p class="review-text">${value ? escapeMultiline(value) : `这一周还没有填写${label}`}</p>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderMonthlySummaryPanel(review, key) {
    return `
      <div class="monthly-summary-stack">
        ${renderMonthlyInsightCard("red", "红灯情况说明", "红灯指向的是同一个事件还是多个？有没有进行针对性调整？本月核心瓶颈是什么？", "redInsight", review.redInsight, key)}
        ${renderMonthlyInsightCard("green", "绿灯情况说明", "这些做得好的事情有什么共同原因吗？有没有什么可复用的地方？", "greenInsight", review.greenInsight, key)}
        <section class="monthly-next-card">
          <div class="weekly-card-title"><i class="weekly-icon blue"></i><strong>下月拟改进</strong></div>
          ${renderMonthlyTextField("下月拟改进的方向", "nextDirection", review.nextDirection, key, "下个月最想优先调整或推进的方向")}
        </section>
      </div>
    `;
  }

  function renderMonthlyInsightCard(tone, title, description, field, value, key) {
    return `
      <section class="monthly-insight-card ${tone}">
        <div class="weekly-card-title">
          <i class="weekly-icon ${tone}"></i>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(description)}</span>
        </div>
        ${renderMonthlyTextField("", field, value, key, description)}
      </section>
    `;
  }

  function renderMonthlyTextField(label, field, value, key, placeholder) {
    if (ui.reviewEditing) {
      return `
        <label class="form-row monthly-text-field">
          ${label ? `<span class="field-label">${escapeHtml(label)}</span>` : ""}
          <textarea rows="${textareaRows(value)}" data-action="update-month-review" data-month-review-key="${escapeAttr(key)}" data-field="${escapeAttr(field)}" placeholder="${escapeAttr(placeholder)}">${escapeHtml(value || "")}</textarea>
        </label>
      `;
    }
    return `<p class="review-text">${value ? escapeMultiline(value) : "还没有填写"}</p>`;
  }

  function renderWeeklyReviewDisplay(review) {
    return `
      <h3 class="weekly-section-heading">红绿灯自评</h3>
      <div class="weekly-reflection-grid">
        ${renderWeeklyReflectionCard("red", "红灯", "本周感到挫败和消耗能量的事", review.red)}
        ${renderWeeklyReflectionCard("green", "绿灯", "本周最有成就感/最顺利的事", review.green)}
      </div>
      <section class="weekly-next-card">
        <div class="weekly-card-title"><i class="weekly-icon blue"></i><strong>下周拟改进</strong></div>
        <p class="review-text">${review.nextDirection ? escapeMultiline(review.nextDirection) : "还没有写下周拟改进的方向"}</p>
      </section>
    `;
  }

  function renderWeeklyReflectionCard(tone, title, subtitle, value) {
    return `
      <section class="weekly-reflection-card ${tone}">
        <div class="weekly-card-title"><i class="weekly-icon ${tone}"></i><strong>${title}</strong><span>${subtitle}</span></div>
        <p class="review-text">${value ? escapeMultiline(value) : "还没有填写"}</p>
      </section>
    `;
  }

  function renderWeeklyReviewEditor(review, key) {
    return `
      <div class="weekly-review-editor" data-weekly-review-key="${escapeAttr(key)}">
        <h3 class="weekly-section-heading">红绿灯自评</h3>
        <label class="form-row">
          <span class="field-label red-field">红灯：本周感到挫败和消耗能量的事</span>
          <textarea rows="${textareaRows(review.red)}" data-action="update-week-review" data-weekly-review-key="${escapeAttr(key)}" data-field="red" placeholder="写下本周让你挫败、卡住、消耗能量的事情">${escapeHtml(review.red || "")}</textarea>
        </label>
        <label class="form-row">
          <span class="field-label green-field">绿灯：本周最有成就感/最顺利的事</span>
          <textarea rows="${textareaRows(review.green)}" data-action="update-week-review" data-weekly-review-key="${escapeAttr(key)}" data-field="green" placeholder="写下本周最顺利、最有成就感的事情">${escapeHtml(review.green || "")}</textarea>
        </label>
        <label class="form-row">
          <span class="field-label blue-field">下周拟改进的方向</span>
          <textarea rows="${textareaRows(review.nextDirection)}" data-action="update-week-review" data-weekly-review-key="${escapeAttr(key)}" data-field="nextDirection" placeholder="下周想优先调整或推进的方向">${escapeHtml(review.nextDirection || "")}</textarea>
        </label>
      </div>
    `;
  }

  function renderReviewNavigator(scope) {
    const date = reviewDate(scope);
    return `
      <div class="date-switch-panel scope-navigator review-scope-navigator">
        <span class="date-label">${scopeSwitchLabel(scope)}</span>
        <button class="date-arrow" type="button" data-action="shift-review-date" data-review-scope="${scope}" data-direction="-1" aria-label="上一个">‹</button>
        <span class="date-display-field">${escapeHtml(scopeDisplay(scope, date))}</span>
        <label class="date-calendar-button" aria-label="选择时间">
          <span aria-hidden="true">▦</span>
          <input type="${scopePickerType(scope)}" value="${escapeAttr(scopePickerValue(scope, date))}" data-action="set-review-scope-date" data-review-scope="${scope}" />
        </label>
        <button class="date-arrow" type="button" data-action="shift-review-date" data-review-scope="${scope}" data-direction="1" aria-label="下一个">›</button>
      </div>
    `;
  }

  function renderPlan(plan, index) {
    return `
      <span class="plan-pill" data-plan-index="${index}">
        ${escapeHtml(plan)}
        ${
              ui.plansEditing
                ? `
              <span class="move-stack">
                <button class="move-button" type="button" data-action="move-plan" data-direction="-1" aria-label="上移">▴</button>
                <button class="move-button" type="button" data-action="move-plan" data-direction="1" aria-label="下移">▾</button>
              </span>
              <button class="ghost-button" type="button" data-action="edit-plan" aria-label="编辑规划">编辑</button>
              <button class="icon-button danger-icon small-icon" type="button" data-action="delete-plan" aria-label="删除规划">×</button>
            `
            : ""
        }
      </span>
    `;
  }

  function renderReviewItem(item, index, scope = state.reviewScope) {
    const review = normalizeReviewItem(item);
    const isEditing = ui.editingReviews.has(item.id);
    const placeholders = reviewPlaceholders(scope);
    if (!isEditing) {
      return `
        <article class="review-item compact-review-item" data-review-id="${review.id}" data-review-scope="${scope}">
          <div class="entry-display-line">
            <span class="review-label phenomenon-label"><i></i><strong>现象${index + 1}</strong></span>
            ${
              ui.reviewEditing
                ? `<div class="row-actions">
                    ${renderReviewStarControl(review, scope)}
                    <span class="move-stack">
                      <button class="move-button" type="button" data-action="move-review-item" data-direction="-1" aria-label="上移">▴</button>
                      <button class="move-button" type="button" data-action="move-review-item" data-direction="1" aria-label="下移">▾</button>
                    </span>
                    <button class="ghost-button compact-action" type="button" data-action="edit-review-item">编辑</button>
                  </div>`
                : renderReviewStarControl(review, scope)
            }
          </div>
          <p class="review-text">${review.phenomenon ? escapeMultiline(review.phenomenon) : "还没有写现象"}</p>
          <div class="review-reason-list">
            ${review.reasons.length ? review.reasons.map((reason, reasonIndex) => renderReasonDisplay(reason, reasonIndex)).join("") : `<p class="review-text">还没有写原因</p>`}
          </div>
        </article>
      `;
    }
    return `
      <article class="review-item editing-review-item" data-review-id="${review.id}" data-review-scope="${scope}">
        <label class="form-row">
          <span class="field-label review-edit-label">现象${index + 1}${renderReviewStarControl(review, scope)}</span>
          <textarea rows="${textareaRows(review.phenomenon)}" data-action="update-review-item" data-field="phenomenon" placeholder="${placeholders.phenomenon}">${escapeHtml(review.phenomenon || "")}</textarea>
        </label>
        <div class="review-reason-editor">
          ${review.reasons.map((reason, reasonIndex) => renderReasonEditor(review.id, reason, reasonIndex, placeholders)).join("")}
        </div>
        <button class="secondary-button add-button" type="button" data-action="add-review-reason" aria-label="新增原因">+</button>
        <div class="button-row">
          <button class="icon-button danger-icon" type="button" data-action="delete-review-item" aria-label="删除复盘">×</button>
          <button class="secondary-button" type="button" data-action="save-review-item">保存</button>
        </div>
      </article>
    `;
  }

  function renderReviewStarControl(review, scope) {
    if (scope !== "day") return "";
    if (!ui.reviewEditing && !review.starred) return "";
    const label = review.starred ? "取消关键事件标记" : "标记为关键事件";
    if (!ui.reviewEditing) return `<span class="review-star active" aria-label="关键事件">★</span>`;
    return `<button class="review-star ${review.starred ? "active" : ""}" type="button" data-action="toggle-review-star" aria-label="${label}">${review.starred ? "★" : "☆"}</button>`;
  }

  function renderReasonDisplay(reason, index) {
    return `
      <div class="review-reason">
        <div class="entry-display-line muted-line"><span class="review-label reason-label"><i></i><strong>原因${index + 1}</strong></span></div>
        <p class="review-text">${reason.text ? escapeMultiline(reason.text) : "还没有写原因"}</p>
        ${reason.measure ? `<div class="entry-display-line muted-line"><span class="review-label measure-label"><i></i><strong>措施</strong></span></div><p class="review-text">${escapeMultiline(reason.measure)}</p>` : ""}
      </div>
    `;
  }

  function renderReasonEditor(reviewId, reason, index, placeholders) {
    return `
      <section class="reason-editor-card" data-reason-id="${reason.id}">
        <div class="section-title mini-title">
          <div><h2>原因${index + 1}</h2></div>
          <button class="icon-button danger-icon small-icon" type="button" data-action="delete-review-reason" data-review-id="${reviewId}" data-reason-id="${reason.id}" aria-label="删除原因">×</button>
        </div>
        <textarea rows="${textareaRows(reason.text)}" data-action="update-review-reason" data-review-id="${reviewId}" data-reason-id="${reason.id}" data-field="text" placeholder="${placeholders.reason}">${escapeHtml(reason.text || "")}</textarea>
        <textarea rows="${textareaRows(reason.measure)}" data-action="update-review-reason" data-review-id="${reviewId}" data-reason-id="${reason.id}" data-field="measure" placeholder="${placeholders.measure}">${escapeHtml(reason.measure || "")}</textarea>
      </section>
    `;
  }

  function renderStatRows(totals, baselineMinutes = null) {
    const entries = Object.entries(totals).filter(([, minutes]) => minutes > 0);
    const recorded = sumMinutes(Object.values(totals));
    const otherMinutes = Math.max(0, (Number(baselineMinutes) || 0) - recorded);
    if (otherMinutes > 0) entries.push(["__other", otherMinutes]);
    if (!entries.length) return `<p class="empty">所选范围还没有时间记录。</p>`;
    return entries
      .map(([tagId, minutes]) => {
        const meta = statMeta(tagId);
        return `
          <div class="stat-row">
            <span class="stat-label"><i class="color-dot" style="background:${meta.color}"></i>${escapeHtml(meta.label)}</span>
            <strong>${formatDuration(minutes)}</strong>
          </div>
        `;
      })
      .join("");
  }

  function statMeta(key) {
    if (key === "__other") return { label: "其他", color: "#d7ddd4" };
    if (key === "__loc_dorm") return { label: "宿舍", color: "#4d8b57" };
    if (key === "__loc_work") return { label: "工位", color: "#4e7fa8" };
    if (key === "__loc_outdoor") return { label: "户外", color: "#d8b74e" };
    const tag = getTag(key);
    return { label: tag?.name || "未分类", color: tag?.color || colors[0] };
  }

  function openModal(title, bodyHtml, afterOpen) {
    closeModal();
    const fragment = $("#modal-template").content.cloneNode(true);
    fragment.querySelector("#modal-title").textContent = title;
    fragment.querySelector("#modal-body").innerHTML = bodyHtml;
    document.body.appendChild(fragment);
    const backdrop = $(".modal-backdrop");
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.dataset.action === "close-modal") closeModal();
    });
    modalCleanup = afterOpen?.(backdrop) || null;
  }

  function closeModal() {
    modalCleanup?.();
    modalCleanup = null;
    $(".modal-backdrop")?.remove();
  }

  function confirmDelete(message, onConfirm) {
    const backdrop = document.createElement("div");
    backdrop.className = "confirm-backdrop";
    backdrop.innerHTML = `
      <section class="confirm-box" role="dialog" aria-modal="true">
        <h2>确认删除</h2>
        <p>${escapeHtml(message)}</p>
        <div class="button-row">
          <button class="secondary-button" type="button" data-confirm="cancel">取消</button>
          <button class="danger-button" type="button" data-confirm="ok">删除</button>
        </div>
      </section>
    `;
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.dataset.confirm === "cancel") backdrop.remove();
      if (event.target.dataset.confirm === "ok") {
        onConfirm();
        backdrop.remove();
      }
    });
    document.body.appendChild(backdrop);
  }

  function openBackupModal() {
    const payload = JSON.stringify(state, null, 2);
    openModal(
      "备份",
      `
        <p class="hint">下载当前数据，或粘贴之前导出的备份内容恢复。</p>
        <textarea id="backup-text" rows="8">${escapeHtml(payload)}</textarea>
        <div class="button-row">
          <button class="primary-button" type="button" data-modal-action="download-backup">下载备份</button>
          <button class="secondary-button" type="button" data-modal-action="import-backup">导入备份</button>
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", (event) => {
          const action = event.target.dataset.modalAction;
          if (action === "download-backup") downloadBackup($("#backup-text", backdrop).value);
          if (action === "import-backup") importBackup($("#backup-text", backdrop).value);
        });
      },
    );
  }

  function downloadBackup(text) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `记录与复盘-${dateKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(text) {
    try {
      const parsed = JSON.parse(text);
      state = normalizeStateShape(parsed);
      saveState();
      clearRecordDrafts();
      closeModal();
      render();
    } catch (error) {
      alert("备份内容不是有效的 JSON。");
    }
  }

  function openVersionModal() {
    const versions = {
      "v1.4": {
        updatedAt: "2026-06-28",
        items: [
          "目标页新增分类标签栏，支持全部/单标签筛选和标签分组收起。",
          "目标大编辑状态下新增目标标签管理入口，可新增、重命名和删除标签。",
          "目标编辑支持设置目标标签，并在母任务下方提供新增二级和标签入口。",
          "目标迁移改为全局迁移今日未完成目标到第二天，保留原目标进度。",
          "迁移后的目标会标注已完成子任务的完成日期。",
          "迁移后的目标会持续同步源日期的未完成目标，源目标完成后会自动从次日移除。",
          "目标标签支持自定义排序，“未分类”固定显示在最后且不作为母任务标签候选项。",
          "目标标签编辑支持设置默认标签，新增目标未手动选择标签时会自动归入默认标签。",
          "周复盘改为学习/工位时长摘要、学习标签占比、红绿灯自评和下周改进措施结构。",
          "复盘页改为日、周、月顶部页签切换，周复盘时长摘要压缩为两行。",
          "月复盘新增周次统计表、月度学习标签占比、红绿灯逐周展开和月度总结结构。",
          "日复盘支持给现象标记关键事件，周复盘可汇总并展开星标事件的原因和措施。",
          "月复盘周次按本月 1 号所在周起算，跨月周只归属到一个月度复盘。",
          "周/月复盘的拟改进区域改为只填写方向，去掉对应措施输入。",
          "目标卡片移除单个迁移按钮，迁移入口移动到目标总编辑按钮旁边。",
          "目标执行天数文案改为“执行第 x 天”。",
          "上下移动按钮统一改为上下竖排布局，减少横向占用。",
          "目标编辑弹窗中母任务删除按钮移动到顶部加号左侧，二级/三级新增按钮文案更清晰。",
        ],
      },
      "v1.3": {
        updatedAt: "2026-06-27",
        items: [
          "新增全局顶部栏：应用图标、标题、轻量版本链接和当前日期统一展示。",
          "日期切换栏改为独立浅色面板，支持左右切换、手动输入和系统日历选择。",
          "所有弹窗改为屏幕居中显示，版本信息弹窗直接展示完整版本记录。",
          "地点时间改为按日期保存，新增、删除和统计只影响当前日期，并兼容旧地点设置。",
          "记录页整合今日、本周、本月汇总，支持任务/地点扇形图和“其他”勾选。",
          "目标页保留日目标逻辑，默认收起子任务，并显示目标执行天数。",
          "目标进度按最低层任务统计，避免母任务、二级任务和三级任务重复计数。",
          "目标编辑改为点状树结构，二级和三级任务支持等宽新增/删除操作行。",
          "复盘页改为日、周、月三段纵向展示，各自拥有独立时间切换栏。",
        ],
      },
      "v1.2": {
        updatedAt: "2026-06-26",
        items: [
          "修复手机输入时因自动同步触发重渲染导致的键盘断触。",
          "优化目标编辑层级，母任务、二级任务和三级任务的字号与层级更清晰。",
          "优化目标进度规则，有子任务时按子任务数量计算，不再计入母任务数量。",
          "优化复盘展示，现象、原因、措施使用不同颜色文字和形状图标。",
          "修复复盘长文本与措施输入框互相遮挡的问题。",
          "优化汇总区，把“其他”勾选放到任务/地点切换左侧。",
        ],
      },
      "v1.1": {
        updatedAt: "2026-06-25",
        items: [
          "新增 Supabase 登录与自动云同步，支持本地和云端数据合并。",
          "新增备份导入导出，并增强云同步错误提示。",
          "优化记录页移动端密度，新增记录、标签编辑和排序更适合手机操作。",
          "新增连续地点时间轴和地点时间分配统计。",
          "新增任务/地点两种汇总扇形图，时间基准统一为日 24h、周 168h、月 720h。",
          "目标支持二级、三级任务、数量进度、单个目标迁移和排序。",
          "习惯追踪支持自定义颜色、最近七天展示、月历详情和达标率统计。",
          "复盘结构升级为现象、原因、措施，并支持日、周、月复盘。",
        ],
      },
    };
    const renderVersionHistory = () =>
      Object.entries(versions)
        .map(
          ([version, detail]) => `
            <section class="version-section">
              <div class="version-meta">
                <strong>${version}</strong>
                <span>更新时间：${detail.updatedAt}</span>
              </div>
              <ol class="version-list">
                ${detail.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ol>
            </section>
          `,
        )
        .join("");
    openModal(
      "版本信息",
      renderVersionHistory(),
    );
  }

  function openLoginModal() {
    openModal(
      session ? "云端同步" : "登录",
      `
        <p class="hint">登录后会自动合并云端和本地数据，之后本地修改会自动保存到 Supabase 表 ${SUPABASE_TABLE}。</p>
        ${
          session
            ? `<p class="sync-status">当前已登录：${escapeHtml(session.user?.email || session.user?.id || "Supabase 用户")}</p>`
            : `<label class="form-row"><span class="field-label">邮箱</span><input id="login-email" type="email" autocomplete="email" /></label>
               <label class="form-row"><span class="field-label">密码</span><input id="login-password" type="password" autocomplete="current-password" /></label>`
        }
        <p id="login-message" class="hint">自动同步：${escapeHtml(syncMeta.message)}${syncMeta.lastSyncedAt ? `，最近同步 ${escapeHtml(syncMeta.lastSyncedAt)}` : ""}</p>
        <p class="hint">若提示 payload does not exist，可在 Supabase SQL Editor 执行：alter table public.${SUPABASE_TABLE} add column if not exists payload jsonb not null default '{}'::jsonb;</p>
        <p class="hint">若提示 permission、RLS 或 on_conflict，则需要检查行级安全策略和 id 唯一约束。</p>
        <div class="button-row">
          ${session ? "" : `<button class="primary-button" type="button" data-modal-action="login">登录</button>`}
          ${
            session
              ? `<button class="secondary-button" type="button" data-modal-action="sync-now">立即同步</button>
                 <button class="secondary-button" type="button" data-modal-action="load-cloud">从云端合并</button>
                 <button class="secondary-button" type="button" data-modal-action="logout">退出登录</button>`
              : ""
          }
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", async (event) => {
          const action = event.target.dataset.modalAction;
          if (!action) return;
          const message = $("#login-message", backdrop);
          try {
            if (action === "login") {
              message.textContent = "正在登录...";
              await loginWithPassword($("#login-email", backdrop).value.trim(), $("#login-password", backdrop).value);
              message.textContent = "登录成功，正在自动同步...";
              await syncRemoteOnLogin();
              message.textContent = syncMeta.message;
              render();
              openLoginModal();
            }
            if (action === "sync-now") {
              message.textContent = "正在同步...";
              await syncRemoteOnLogin();
              message.textContent = syncMeta.message;
              render();
            }
            if (action === "load-cloud") {
              message.textContent = "正在合并云端数据...";
              await loadRemoteState();
              message.textContent = syncMeta.message;
              closeModal();
              render();
            }
            if (action === "logout") {
              session = null;
              localStorage.removeItem(SESSION_KEY);
              syncMeta.status = "offline";
              syncMeta.message = "未登录";
              syncMeta.lastSyncedAt = "";
              render();
              closeModal();
            }
          } catch (error) {
            message.textContent = error.message || "操作失败。";
          }
        });
      },
    );
  }

  async function loginWithPassword(email, password) {
    if (!email || !password) throw new Error("请填写邮箱和密码。");
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: supabaseHeaders(false),
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.msg || "登录失败。");
    session = data;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  async function ensureFreshSession() {
    if (!session?.access_token) throw new Error("请先登录。");
    const expiresAt = Number(session.expires_at || 0);
    if (!expiresAt || Date.now() / 1000 < expiresAt - 60) return;
    if (!session.refresh_token) throw new Error("登录已过期，请重新登录。");
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: supabaseHeaders(false),
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.msg || "登录刷新失败，请重新登录。");
    session = data;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function supabaseHeaders(useSession = true, extra = {}) {
    return {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${useSession && session?.access_token ? session.access_token : SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  function queueRemoteSave() {
    if (!session?.access_token) return;
    clearTimeout(remoteSaveTimer);
    syncMeta.status = "queued";
    syncMeta.message = "等待自动同步";
    remoteSaveTimer = setTimeout(() => {
      saveRemoteNow()
        .catch((error) => {
          console.warn(error);
          syncMeta.status = "error";
          syncMeta.message = error.message || "自动同步失败";
        });
    }, 900);
  }

  async function saveRemoteNow() {
    await ensureFreshSession();
    if (!session.user?.id) throw new Error("请先登录。");
    syncMeta.status = "saving";
    syncMeta.message = "正在自动同步";
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`, {
      method: "POST",
      headers: supabaseHeaders(true, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        id: session.user.id,
        user_id: session.user.id,
        payload: state,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      const detail = await readableRemoteError(response);
      syncMeta.status = "error";
      syncMeta.message = detail;
      throw new Error(detail);
    }
    syncMeta.status = "synced";
    syncMeta.message = "已自动同步";
    syncMeta.lastSyncedAt = compactDateTime(new Date());
  }

  async function loadRemoteState() {
    const payload = await fetchRemotePayload();
    if (!payload) throw new Error("云端还没有备份数据。");
    state = mergeCloudState(state, payload);
    saveState({ remote: false });
    clearRecordDrafts();
    await saveRemoteNow();
    syncMeta.status = "synced";
    syncMeta.message = "已合并云端数据";
    syncMeta.lastSyncedAt = compactDateTime(new Date());
  }

  async function fetchRemotePayload() {
    await ensureFreshSession();
    if (!session.user?.id) throw new Error("请先登录。");
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(session.user.id)}&select=payload&limit=1`, {
      headers: supabaseHeaders(),
    });
    if (!response.ok) throw new Error(await readableRemoteError(response));
    const rows = await response.json();
    return rows.length && rows[0].payload ? rows[0].payload : null;
  }

  async function syncRemoteOnLogin() {
    const remotePayload = await fetchRemotePayload();
    if (remotePayload) {
      state = mergeCloudState(state, remotePayload);
      saveState({ remote: false });
      clearRecordDrafts();
      await saveRemoteNow();
      syncMeta.message = "已自动合并并同步";
      return;
    }
    await saveRemoteNow();
    syncMeta.message = "云端已创建自动备份";
  }

  async function readableRemoteError(response) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      const detail = [data.message || data.msg, data.details, data.hint, data.code ? `代码 ${data.code}` : "", `HTTP ${response.status}`]
        .filter(Boolean)
        .join("；");
      return explainRemoteError(detail || text || `云端操作失败 HTTP ${response.status}`);
    } catch (error) {
      return explainRemoteError(text || `云端操作失败 HTTP ${response.status}`);
    }
  }

  function explainRemoteError(message) {
    if (/payload does not exist|42703/i.test(message)) {
      return `${message}。需要在 Supabase 的 ${SUPABASE_TABLE} 表中增加 jsonb 类型的 payload 列。`;
    }
    if (/permission|rls|row-level|42501/i.test(message)) {
      return `${message}。需要检查 ${SUPABASE_TABLE} 的 RLS 策略是否允许当前用户 select/insert/update 自己的数据。`;
    }
    if (/on_conflict|unique|constraint|42P10/i.test(message)) {
      return `${message}。需要让 ${SUPABASE_TABLE}.id 成为 primary key 或 unique。`;
    }
    return message;
  }

  function openDatePicker() {
    const input = $("#global-date-picker") || $("#global-date");
    if (input.showPicker) input.showPicker();
    else input.focus();
  }

  function openSegmentsModal() {
    openModal(
      "调整时段",
      `
        <div class="tag-editor">
          ${state.settings.segments
            .map(
              (segment) => `
                <div class="grid-3" data-segment-editor="${segment.id}">
                  <label class="form-row"><span class="field-label">名称</span><input value="${escapeAttr(segment.name)}" data-segment-field="name" /></label>
                  <label class="form-row"><span class="field-label">开始</span><input type="time" value="${segment.start}" data-segment-field="start" /></label>
                  <label class="form-row"><span class="field-label">结束</span><input type="time" value="${segment.end}" data-segment-field="end" /></label>
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="button-row">
          <button class="primary-button" type="button" data-modal-action="save-segments">保存</button>
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", (event) => {
          if (event.target.dataset.modalAction === "save-segments") {
            setState((draft) => {
              $$("[data-segment-editor]", backdrop).forEach((row) => {
                const segment = draft.settings.segments.find((item) => item.id === row.dataset.segmentEditor);
                if (!segment) return;
                segment.name = $("[data-segment-field='name']", row).value.trim() || segment.name;
                segment.start = $("[data-segment-field='start']", row).value || segment.start;
                segment.end = $("[data-segment-field='end']", row).value || segment.end;
              });
            });
            closeModal();
          }
        });
      },
    );
  }

  function openLocationsModal() {
    const locations = normalizeLocations(state.settings.locations);
    openModal(
      "地点时间轴",
      `
        <p class="hint">绿色是宿舍，蓝色是工位，未覆盖的时间自动算作户外。</p>
        ${renderLocationSection("work", "工位", locations.work)}
        ${renderLocationSection("dorm", "宿舍", locations.dorm)}
        <div class="location-legend">
          <span><i class="legend-dot dorm"></i>宿舍</span>
          <span><i class="legend-dot work"></i>工位</span>
          <span><i class="legend-dot outdoor"></i>户外</span>
        </div>
        <div class="button-row">
          <button class="primary-button" type="button" data-modal-action="save-locations">保存</button>
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", (event) => {
          const action = event.target.dataset.modalAction;
          if (action === "add-location-row") {
            const type = event.target.dataset.locationType;
            const list = $(`[data-location-list="${type}"]`, backdrop);
            $(".empty", list)?.remove();
            list.insertAdjacentHTML("beforeend", renderLocationRow(type));
            return;
          }
          if (action === "delete-location-row") {
            event.target.closest("[data-location-row]")?.remove();
            return;
          }
          if (action !== "save-locations") return;
          setState((draft) => {
            draft.settings.locations = collectLocationRows(backdrop);
          });
          closeModal();
        });
      },
    );
  }

  function renderLocationSection(type, title, rows) {
    return `
      <section class="location-section">
        <div class="section-title mini-title">
          <div><h2>${title}</h2></div>
          <button class="secondary-button add-button" type="button" data-modal-action="add-location-row" data-location-type="${type}" aria-label="新增${title}记录">+</button>
        </div>
        <div class="location-row-list" data-location-list="${type}">
          ${rows.length ? rows.map((row) => renderLocationRow(type, row)).join("") : `<p class="empty compact-empty">暂无${title}记录。</p>`}
        </div>
      </section>
    `;
  }

  function renderLocationRow(type, row = null) {
    return `
      <div class="location-row" data-location-row data-location-type="${type}" data-location-id="${row?.id || ""}">
        <label class="form-row"><span class="field-label">到达</span><input type="time" data-location-field="arrive" value="${row?.arrive || (type === "work" ? "09:00" : "22:30")}" /></label>
        <label class="form-row"><span class="field-label">离开</span><input type="time" data-location-field="leave" value="${row?.leave || (type === "work" ? "18:00" : "06:00")}" /></label>
        <button class="danger-button" type="button" data-modal-action="delete-location-row">删除</button>
      </div>
    `;
  }

  function collectLocationRows(backdrop) {
    const result = { work: [], dorm: [] };
    $$("[data-location-row]", backdrop).forEach((row) => {
      const type = row.dataset.locationType;
      const arrive = $("[data-location-field='arrive']", row).value;
      const leave = $("[data-location-field='leave']", row).value;
      if (!result[type] || !arrive || !leave || arrive === leave) return;
      result[type].push({
        id: row.dataset.locationId || uid(),
        arrive,
        leave,
      });
    });
    return result;
  }

  function openTagsModal() {
    openModal("维护标签", renderTagEditor(), (backdrop) => {
      backdrop.addEventListener("click", (event) => {
        const action = event.target.dataset.modalAction;
        if (!action) return;
        if (action === "add-tag") {
          const newTag = { id: uid(), name: "新标签", color: colors[state.settings.tags.length % colors.length], subtags: ["默认"] };
          state.settings.tags.push(newTag);
          saveState();
          $("#modal-body", backdrop).innerHTML = renderTagEditor();
        }
        if (action === "add-subtag") {
          const tag = state.settings.tags.find((item) => item.id === event.target.closest("[data-tag-editor]").dataset.tagEditor);
          tag?.subtags.push("新分类");
          saveState();
          $("#modal-body", backdrop).innerHTML = renderTagEditor();
        }
        if (action === "delete-tag") {
          const tagId = event.target.closest("[data-tag-editor]").dataset.tagEditor;
          if (state.settings.tags.length <= 1) return;
          confirmDelete("确认要删除这个一级标签吗？", () => {
            state.settings.tags = state.settings.tags.filter((tag) => tag.id !== tagId);
            saveState();
            $("#modal-body", backdrop).innerHTML = renderTagEditor();
          });
        }
        if (action === "delete-subtag") {
          const row = event.target.closest("[data-subtag-index]");
          const tag = state.settings.tags.find((item) => item.id === event.target.closest("[data-tag-editor]").dataset.tagEditor);
          confirmDelete("确认要删除这个二级标签吗？", () => {
            tag.subtags.splice(Number(row.dataset.subtagIndex), 1);
            if (!tag.subtags.length) tag.subtags.push("默认");
            saveState();
            $("#modal-body", backdrop).innerHTML = renderTagEditor();
          });
        }
        if (action === "save-tags") {
          setState((draft) => {
            const nextTags = $$("[data-tag-editor]", backdrop)
              .map((card) => {
                const original = draft.settings.tags.find((item) => item.id === card.dataset.tagEditor);
                const subtags = $$("[data-subtag-index]", card)
                  .map((row) => $("[data-subtag-field]", row).value.trim())
                  .filter(Boolean);
                return {
                  id: original?.id || uid(),
                  name: $("[data-tag-field='name']", card).value.trim() || original?.name || "新标签",
                  color: $("[data-tag-field='color']", card).value || original?.color || colors[0],
                  subtags: subtags.length ? subtags : ["默认"],
                };
              });
            if (nextTags.length) draft.settings.tags = nextTags;
          });
          closeModal();
        }
      });
    });
  }

  function renderTagEditor() {
    return `
      <div class="tag-editor">
        ${state.settings.tags
          .map(
            (tag) => `
              <section class="tag-card" data-tag-editor="${tag.id}">
                <div class="tag-card-header">
                  <input value="${escapeAttr(tag.name)}" data-tag-field="name" aria-label="标签名称" />
                  <input type="color" value="${tag.color}" data-tag-field="color" aria-label="标签颜色" />
                  <button class="icon-button danger-icon" type="button" data-modal-action="delete-tag" aria-label="删除标签">×</button>
                </div>
                <div class="tag-editor">
                  ${tag.subtags
                    .map(
                      (subtag, index) => `
                        <div class="subtag-row" data-subtag-index="${index}">
                          <input value="${escapeAttr(subtag)}" data-subtag-field aria-label="二级标签" />
                          <button class="icon-button danger-icon" type="button" data-modal-action="delete-subtag" aria-label="删除二级标签">×</button>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
                <button class="secondary-button add-button" type="button" data-modal-action="add-subtag" aria-label="新增二级标签">+</button>
              </section>
            `,
          )
          .join("")}
      </div>
      <div class="button-row">
        <button class="secondary-button add-button" type="button" data-modal-action="add-tag" aria-label="新增一级标签">+</button>
        <button class="primary-button" type="button" data-modal-action="save-tags">保存标签</button>
      </div>
    `;
  }

  function openTargetTagsModal() {
    openModal("编辑目标标签", renderTargetTagEditor(), (backdrop) => {
      backdrop.addEventListener("click", (event) => {
        const action = event.target.dataset.modalAction;
        if (action === "add-target-tag-row") {
          const list = $("[data-target-tag-list]", backdrop);
          list.insertAdjacentHTML("beforeend", renderTargetTagRow(""));
          return;
        }
        if (action === "delete-target-tag-row") {
          event.target.closest("[data-target-tag-row]")?.remove();
          return;
        }
        if (action === "move-target-tag-row") {
          const row = event.target.closest("[data-target-tag-row]");
          const direction = Number(event.target.dataset.direction) || 0;
          if (!row) return;
          if (direction < 0 && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
          if (direction > 0 && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
          return;
        }
        if (action === "save-target-tags") {
          const rows = $$("[data-target-tag-row]", backdrop);
          const nextTags = rows
            .map((row) => $("[data-target-tag-field]", row).value.trim())
            .filter((tag) => tag && tag !== "未分类");
          const uniqueTags = orderTargetTags(nextTags);
          const defaultRadio = $("[data-target-default-radio]:checked", backdrop);
          const defaultRow = defaultRadio?.closest("[data-target-tag-row]");
          const selectedDefault = defaultRow ? $("[data-target-tag-field]", defaultRow).value.trim() : defaultRadio?.dataset.defaultTag;
          const nextDefaultTag = normalizedTargetDefaultTag(selectedDefault, uniqueTags);
          const renameMap = new Map();
          rows.forEach((row) => {
            const original = row.dataset.originalTag;
            const next = $("[data-target-tag-field]", row).value.trim();
            if (original && original !== next) renameMap.set(original, next || "未分类");
          });
          const keptOriginals = new Set(rows.map((row) => row.dataset.originalTag).filter(Boolean));
          setState((draft) => {
            draft.settings.targetTags = uniqueTags;
            draft.settings.targetDefaultTag = nextDefaultTag;
            renameTargetTags(draft, renameMap, keptOriginals);
            draft.settings.targetDefaultTag = normalizedTargetDefaultTag(draft.settings.targetDefaultTag, draft.settings.targetTags);
          });
          closeModal();
        }
      });
    });
  }

  function renderTargetTagEditor() {
    const editableTags = targetTagList().filter((tag) => tag !== "未分类");
    const defaultTag = defaultTargetTag();
    return `
      <p class="hint">删除标签后，使用该标签的目标会归入“未分类”。</p>
      <div class="target-tag-editor-list" data-target-tag-list>
        ${editableTags.map((tag) => renderTargetTagRow(tag, defaultTag)).join("")}
      </div>
      <div class="target-tag-row fixed-target-tag-row">
        <input class="target-default-radio" type="radio" name="target-default-tag" data-target-default-radio data-default-tag="未分类" ${defaultTag === "未分类" ? "checked" : ""} aria-label="设为默认标签" />
        <input value="未分类" disabled aria-label="默认标签" />
        <span class="hint">默认</span>
      </div>
      <div class="button-row">
        <button class="secondary-button" type="button" data-modal-action="add-target-tag-row">新增标签</button>
        <button class="primary-button" type="button" data-modal-action="save-target-tags">保存标签</button>
      </div>
    `;
  }

  function renderTargetTagRow(tag, defaultTag = defaultTargetTag()) {
    return `
      <div class="target-tag-row" data-target-tag-row data-original-tag="${escapeAttr(tag)}">
        <input class="target-default-radio" type="radio" name="target-default-tag" data-target-default-radio ${defaultTag === tag ? "checked" : ""} aria-label="设为默认标签" />
        <input data-target-tag-field value="${escapeAttr(tag)}" placeholder="标签名" />
        <div class="target-tag-row-actions">
          <div class="move-stack" aria-label="调整标签顺序">
            <button class="move-button" type="button" data-modal-action="move-target-tag-row" data-direction="-1" aria-label="上移标签">▲</button>
            <button class="move-button" type="button" data-modal-action="move-target-tag-row" data-direction="1" aria-label="下移标签">▼</button>
          </div>
          <button class="danger-button" type="button" data-modal-action="delete-target-tag-row">删除</button>
        </div>
      </div>
    `;
  }

  function openTargetModal(existingTarget = null) {
    const isEdit = Boolean(existingTarget);
    const children = existingTarget?.children?.length ? existingTarget.children : [];
    const targetTagValue = targetTag(existingTarget);
    openModal(
      isEdit ? "编辑目标" : "新增目标",
      `
        <section class="target-tree-editor">
          <div class="target-progress-row">
            <label class="check-inline">
              <input id="target-progress" class="checkbox" type="checkbox" ${existingTarget?.hasProgress !== false ? "checked" : ""} />
              进度条
            </label>
            ${isEdit ? `<button class="danger-button target-delete-inline" type="button" data-modal-action="delete-target-modal">删除</button>` : ""}
          </div>
          <div class="task-edit-node level-1 parent-node ${existingTarget?.description ? "show-description" : ""}">
            <div class="task-edit-line">
              <span class="task-level-dot"></span>
              <input id="target-name" class="task-name-input" value="${escapeAttr(existingTarget?.name || "")}" placeholder="母任务" />
              <input id="target-total" class="task-total-input" type="number" min="1" step="1" value="${existingTarget?.total || 1}" placeholder="数量" aria-label="母任务数量" />
              <button class="icon-button description-toggle" type="button" data-modal-action="toggle-task-description" aria-label="添加或收起描述">☰</button>
            </div>
            <textarea id="target-description" class="task-description-input" rows="${textareaRows(existingTarget?.description)}" placeholder="可选，一句话描述">${escapeHtml(existingTarget?.description || "")}</textarea>
            <p class="hint">有二级任务时，进度按二级/三级任务数量计算，不再计算母任务数量。</p>
            <div class="task-node-actions parent-node-actions">
              <button class="secondary-button text-add-button" type="button" data-modal-action="add-child-row">新增二级</button>
              <button class="secondary-button text-add-button" type="button" data-modal-action="toggle-target-tag">标签</button>
            </div>
            <label class="target-tag-editor ${targetTagValue !== "未分类" ? "show-target-tag" : ""}">
              <span class="field-label">目标标签</span>
              <input id="target-tag" list="target-tag-options" value="${escapeAttr(targetTagValue === "未分类" ? "" : targetTagValue)}" placeholder="例如：论文、英语、运动" />
              <datalist id="target-tag-options">
                ${targetTagList(targetsForCurrentScope()).filter((tag) => tag !== "未分类").map((tag) => `<option value="${escapeAttr(tag)}"></option>`).join("")}
              </datalist>
            </label>
          </div>
          <div id="child-editor" class="task-tree-children">
            ${children.length ? children.map(renderChildEditor).join("") : renderChildEditor()}
          </div>
        </section>
        <div class="button-row">
          <button class="primary-button" type="button" data-modal-action="save-target">${isEdit ? "保存" : "创建"}</button>
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", (event) => {
          const action = event.target.dataset.modalAction;
          if (action === "add-child-row") {
            $("#child-editor", backdrop).insertAdjacentHTML("beforeend", renderChildEditor());
          }
          if (action === "add-grandchild-row") {
            event.target.closest("[data-child-row]")?.querySelector("[data-grandchild-editor]")?.insertAdjacentHTML("beforeend", renderGrandchildEditor());
          }
          if (action === "toggle-task-description") {
            event.target.closest(".task-edit-node")?.classList.toggle("show-description");
          }
          if (action === "toggle-target-tag") {
            $(".target-tag-editor", backdrop)?.classList.toggle("show-target-tag");
          }
          if (action === "delete-grandchild-row") {
            const row = event.target.closest("[data-grandchild-row]");
            confirmDelete("确认要删除这个三级任务吗？", () => row.remove());
          }
          if (action === "delete-child-row") {
            const row = event.target.closest("[data-child-row]");
            confirmDelete("确认要删除这个子任务吗？", () => row.remove());
          }
          if (action === "delete-target-modal") {
            confirmDelete("确认要删除这个目标吗？", () => {
              deleteTarget(existingTarget.id);
              closeModal();
            });
          }
          if (action === "save-target") {
            const targetData = collectTargetForm(backdrop, existingTarget);
            setState((draft) => {
              const list = targetsForScopeDraft(draft, state.targetScope, scopeKey(state.targetScope));
              if (existingTarget) {
                const index = list.findIndex((item) => item.id === existingTarget.id);
                list[index] = targetData;
              } else {
                list.push(targetData);
              }
            });
            closeModal();
          }
        });
      },
    );
  }

  function renderChildEditor(child = null) {
    return `
      <section class="task-edit-node level-2 ${child?.description ? "show-description" : ""}" data-child-row data-child-id="${child?.id || ""}">
        <div class="task-edit-line">
          <span class="task-level-dot"></span>
          <input class="task-name-input" data-child-field="name" value="${escapeAttr(child?.name || "")}" placeholder="二级任务" />
          <input class="task-total-input" data-child-field="total" type="number" min="1" step="1" value="${child?.total || 1}" placeholder="数量" aria-label="二级任务数量" />
          <button class="icon-button description-toggle" type="button" data-modal-action="toggle-task-description" aria-label="添加或收起描述">☰</button>
        </div>
        <textarea class="task-description-input" data-child-field="description" rows="${textareaRows(child?.description)}" placeholder="可选，一句话描述">${escapeHtml(child?.description || "")}</textarea>
        <div class="task-node-actions">
          <button class="secondary-button add-button text-add-button" type="button" data-modal-action="add-grandchild-row" aria-label="新增三级任务">新增三级</button>
          <button class="danger-button" type="button" data-modal-action="delete-child-row" aria-label="删除二级任务">删除</button>
        </div>
        <div class="task-tree-children" data-grandchild-editor>
          ${(child?.children || []).map(renderGrandchildEditor).join("")}
        </div>
      </section>
    `;
  }

  function renderGrandchildEditor(grandchild = null) {
    return `
      <section class="task-edit-node level-3 ${grandchild?.description ? "show-description" : ""}" data-grandchild-row data-grandchild-id="${grandchild?.id || ""}">
        <div class="task-edit-line">
          <span class="task-level-dot"></span>
          <input class="task-name-input" data-grandchild-field="name" value="${escapeAttr(grandchild?.name || "")}" placeholder="三级任务" aria-label="三级任务" />
          <input class="task-total-input" data-grandchild-field="total" type="number" min="1" step="1" value="${grandchild?.total || 1}" placeholder="数量" aria-label="三级任务数量" />
          <button class="icon-button description-toggle" type="button" data-modal-action="toggle-task-description" aria-label="添加或收起描述">☰</button>
        </div>
        <textarea class="task-description-input" data-grandchild-field="description" rows="${textareaRows(grandchild?.description)}" placeholder="可选，一句话描述">${escapeHtml(grandchild?.description || "")}</textarea>
        <div class="task-node-actions">
          <button class="secondary-button add-button text-add-button" type="button" data-modal-action="add-grandchild-row" aria-label="新增三级任务">新增三级</button>
          <button class="danger-button" type="button" data-modal-action="delete-grandchild-row" aria-label="删除三级任务">删除</button>
        </div>
      </section>
    `;
  }

  function collectTargetForm(backdrop, existingTarget) {
    const childRows = $$("[data-child-row]", backdrop);
    const children = childRows
      .map((row) => {
        const name = $("[data-child-field='name']", row).value.trim();
        if (!name) return null;
        const existingChild = findChild(existingTarget, row.dataset.childId);
        const total = Math.max(1, Number($("[data-child-field='total']", row).value) || 1);
        const grandchildren = $$("[data-grandchild-row]", row)
          .map((grandRow) => {
            const childName = $("[data-grandchild-field='name']", grandRow).value.trim();
            if (!childName) return null;
            const childTotal = Math.max(1, Number($("[data-grandchild-field='total']", grandRow).value) || 1);
            const existing = existingChild?.children?.find((item) => item.id === grandRow.dataset.grandchildId || item.name === childName);
            return {
              id: existing?.id || uid(),
              name: childName,
              description: $("[data-grandchild-field='description']", grandRow).value.trim(),
              hasProgress: true,
              total: childTotal,
              done: Math.min(existing?.done || 0, childTotal),
              completedAt: existing?.completedAt || "",
              children: [],
            };
          })
          .filter(Boolean);
        return {
          id: existingChild?.id || uid(),
          name,
          description: $("[data-child-field='description']", row).value.trim(),
          hasProgress: true,
          total,
          done: Math.min(existingChild?.done || 0, total),
          completedAt: existingChild?.completedAt || "",
          children: grandchildren,
        };
      })
      .filter(Boolean);

    const total = Math.max(1, Number($("#target-total", backdrop).value) || 1);
    const rawTag = $("#target-tag", backdrop)?.value.trim() || "";
    const fallbackTag = existingTarget ? "未分类" : defaultTargetTag();
    return {
      id: existingTarget?.id || uid(),
      name: $("#target-name", backdrop).value.trim() || "未命名目标",
      tag: rawTag && rawTag !== "未分类" ? rawTag : fallbackTag,
      description: $("#target-description", backdrop).value.trim(),
      hasProgress: $("#target-progress", backdrop).checked,
      total,
      done: Math.min(existingTarget?.done || 0, total),
      completedAt: existingTarget?.completedAt || "",
      startedAt: existingTarget?.startedAt || dateKey(),
      collapsed: existingTarget?.collapsed ?? true,
      children,
    };
  }

  function openHabitModal(existingHabit = null) {
    const currentValue = existingHabit?.records?.[dateKey()] ?? 0;
    const currentColor = existingHabit?.color || colors[0];
    openModal(
      existingHabit ? "编辑习惯" : "新增习惯",
      `
        <label class="form-row">
          <span class="field-label">习惯名称</span>
          <input id="habit-name" value="${escapeAttr(existingHabit?.name || "")}" placeholder="例如：英语口语 15 分钟" />
        </label>
        <div class="compact-form-row">
          <label class="form-row">
            <span class="field-label">圆圈颜色</span>
            <input id="habit-color" class="square-color-input" type="color" value="${currentColor}" />
          </label>
          <label class="form-row">
            <span class="field-label">今日完成度</span>
            <input id="habit-percent-number" type="number" min="0" max="100" step="5" value="${currentValue}" />
          </label>
        </div>
        <div class="habit-edit-preview">
          <span id="habit-preview">${renderHabitOrb(currentValue, currentColor)}</span>
          <input id="habit-percent-range" class="range" type="range" min="0" max="100" step="1" value="${currentValue}" />
        </div>
        ${existingHabit ? `<button class="icon-button danger-icon modal-delete" type="button" data-modal-action="delete-habit-modal" aria-label="删除习惯">×</button>` : ""}
        <div class="button-row">
          <button class="primary-button" type="button" data-modal-action="save-habit">保存</button>
        </div>
      `,
      (backdrop) => {
        const range = $("#habit-percent-range", backdrop);
        const number = $("#habit-percent-number", backdrop);
        const color = $("#habit-color", backdrop);
        const preview = $("#habit-preview", backdrop);
        const syncPreview = () => {
          const percent = clamp(Number(number.value) || 0, 0, 100);
          range.value = percent;
          preview.innerHTML = renderHabitOrb(percent, color.value || colors[0]);
        };
        range.addEventListener("input", () => {
          number.value = range.value;
          syncPreview();
        });
        number.addEventListener("input", syncPreview);
        color.addEventListener("input", syncPreview);
        backdrop.addEventListener("click", (event) => {
          if (event.target.dataset.modalAction === "delete-habit-modal") {
            confirmDelete("确认要删除这个习惯吗？", () => {
              deleteHabit(existingHabit.id);
              closeModal();
            });
            return;
          }
          if (event.target.dataset.modalAction !== "save-habit") return;
          const name = $("#habit-name", backdrop).value.trim() || "未命名习惯";
          const percent = clamp(Number($("#habit-percent-number", backdrop).value) || 0, 0, 100);
          const color = $("#habit-color", backdrop).value || colors[0];
          setState((draft) => {
            if (existingHabit) {
              const habit = draft.habits.find((item) => item.id === existingHabit.id);
              habit.name = name;
              habit.color = color;
              habit.records ||= {};
              habit.records[dateKey()] = percent;
            } else {
              draft.habits.push({ id: uid(), name, color, records: { [dateKey()]: percent } });
            }
          });
          closeModal();
        });
      },
    );
  }

  function openHabitCalendar(habit) {
    const current = new Date(`${dateKey()}T00:00:00`);
    const year = current.getFullYear();
    const month = current.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startOffset; i += 1) cells.push(`<div class="calendar-cell muted"></div>`);
    for (let day = 1; day <= days; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const value = habit.records?.[iso] ?? 0;
      cells.push(`
        <div class="calendar-cell">
          <span>${day}</span>
          ${renderHabitOrb(value, habit.color || colors[0], true, true)}
        </div>
      `);
    }
    openModal(
      `${habit.name} · 月历`,
      `
        <div class="calendar">
          <div class="calendar-header">
            <strong>${year}年${month + 1}月</strong>
            <span class="hint">圆圈大小随完成度平滑变化，100% 显示花花</span>
          </div>
          <div class="calendar-grid">${["日", "一", "二", "三", "四", "五", "六"].map((d) => `<strong class="calendar-cell">${d}</strong>`).join("")}${cells.join("")}</div>
        </div>
      `,
    );
  }

  function openPlanModal(index = null) {
    const value = index === null ? "" : state.settings.plans[index];
    openModal(
      index === null ? "新增长期规划" : "编辑长期规划",
      `
        <label class="form-row">
          <span class="field-label">规划</span>
          <input id="plan-text" value="${escapeAttr(value || "")}" placeholder="例如：提升文献阅读能力" />
        </label>
        ${index === null ? "" : `<button class="icon-button danger-icon modal-delete" type="button" data-modal-action="delete-plan-modal" aria-label="删除规划">×</button>`}
        <div class="button-row">
          <button class="primary-button" type="button" data-modal-action="save-plan">保存</button>
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", (event) => {
          if (event.target.dataset.modalAction === "delete-plan-modal") {
            confirmDelete("确认要删除这个长期规划吗？", () => {
              deletePlan(index);
              closeModal();
            });
            return;
          }
          if (event.target.dataset.modalAction !== "save-plan") return;
          const text = $("#plan-text", backdrop).value.trim();
          setState((draft) => {
            if (!text) return;
            if (index === null) draft.settings.plans.push(text);
            else draft.settings.plans[index] = text;
          });
          closeModal();
        });
      },
    );
  }

  document.addEventListener("click", (event) => {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    if (action === "close-modal") return closeModal();
    if (action === "shift-date") return shiftDate(Number(actionNode.dataset.days) || 0);
    if (action === "open-date-picker") return openDatePicker();
    if (action === "open-backup") return openBackupModal();
    if (action === "open-version") {
      event.preventDefault();
      return openVersionModal();
    }
    if (action === "open-login") return openLoginModal();
    if (action === "shift-scope-date") return shiftScopeDate(actionNode.dataset.owner, Number(actionNode.dataset.direction) || 0);
    if (action === "set-record-summary-scope") return setRecordSummaryScope(actionNode.dataset.scope);
    if (action === "set-summary-mode") return setSummaryMode(actionNode.dataset.owner, actionNode.dataset.mode);
    if (action === "toggle-summary-other") return toggleSummaryOther(actionNode.dataset.owner, actionNode.checked);
    if (action === "toggle-record-edit") return toggleEditMode("recordEditing");
    if (action === "toggle-target-edit") return toggleEditMode("targetEditing");
    if (action === "toggle-habit-edit") return toggleEditMode("habitEditing");
    if (action === "toggle-review-edit") return toggleEditMode("reviewEditing");
    if (action === "edit-segments") return openSegmentsModal();
    if (action === "edit-tags") return openTagsModal();
    if (action === "add-location") return addLocationRecord();
    if (action === "edit-location") return editLocationRecord(actionNode.closest("[data-location-id]").dataset.locationId);
    if (action === "save-location") return saveLocationRecord(actionNode.closest("[data-location-id]"));
    if (action === "delete-location") return requestDeleteLocation(actionNode.closest("[data-location-id]"));
    if (action === "add-log") return addLog(actionNode.dataset.segmentId);
    if (action === "edit-log") return editLog(actionNode.closest("[data-log-id]").dataset.logId);
    if (action === "save-log") return saveLog(actionNode.closest("[data-log-id]"));
    if (action === "delete-log") return requestDeleteLog(actionNode.closest("[data-log-id]"));
    if (action === "move-log") return moveLog(actionNode.closest("[data-log-id]").dataset.logId, Number(actionNode.dataset.direction));
    if (action === "set-target-scope") return setState((draft) => (draft.targetScope = actionNode.dataset.scope));
    if (action === "add-target") return openTargetModal();
    if (action === "set-target-filter") return setTargetFilter(actionNode.dataset.tag);
    if (action === "toggle-target-category") return toggleTargetCategory(actionNode.dataset.tag);
    if (action === "edit-target-tags") return openTargetTagsModal();
    if (action === "migrate-incomplete-targets") return migrateIncompleteTargets();
    if (action === "toggle-target") return toggleTarget(actionNode.closest("[data-target-id]").dataset.targetId);
    if (action === "edit-target") return openTargetModal(getTarget(actionNode.closest("[data-target-id]").dataset.targetId));
    if (action === "delete-target") return confirmDelete("确认要删除这个目标吗？", () => deleteTarget(actionNode.closest("[data-target-id]").dataset.targetId));
    if (action === "move-target") return moveTarget(actionNode.closest("[data-target-id]").dataset.targetId, Number(actionNode.dataset.direction));
    if (action === "move-subtask") return moveSubtask(actionNode.dataset.targetId, actionNode.dataset.subtaskId, Number(actionNode.dataset.direction));
    if (action === "step-progress") return stepProgress(actionNode.dataset.targetId, actionNode.dataset.subtaskId, Number(actionNode.dataset.delta));
    if (action === "add-habit") return openHabitModal();
    if (action === "edit-habit") return openHabitModal(getHabit(actionNode.closest("[data-habit-id]").dataset.habitId));
    if (action === "delete-habit") return confirmDelete("确认要删除这个习惯吗？", () => deleteHabit(actionNode.closest("[data-habit-id]").dataset.habitId));
    if (action === "move-habit") return moveHabit(actionNode.closest("[data-habit-id]").dataset.habitId, Number(actionNode.dataset.direction));
    if (action === "open-habit-calendar") return openHabitCalendar(getHabit(actionNode.closest("[data-habit-id]").dataset.habitId));
    if (action === "set-review-scope") return setState((draft) => (draft.reviewScope = actionNode.dataset.scope));
    if (action === "set-month-review-mode") return setMonthReviewMode(actionNode.dataset.mode);
    if (action === "toggle-key-event-detail") return toggleKeyEventDetail(actionNode.dataset.keyEventId);
    if (action === "shift-review-date") return shiftReviewDate(actionNode.dataset.reviewScope, Number(actionNode.dataset.direction) || 0);
    if (action === "add-plan") return openPlanModal();
    if (action === "toggle-plan-edit") return togglePlanEdit();
    if (action === "edit-plan") return openPlanModal(Number(actionNode.closest("[data-plan-index]").dataset.planIndex));
    if (action === "delete-plan") return confirmDelete("确认要删除这个长期规划吗？", () => deletePlan(Number(actionNode.closest("[data-plan-index]").dataset.planIndex)));
    if (action === "move-plan") return movePlan(Number(actionNode.closest("[data-plan-index]").dataset.planIndex), Number(actionNode.dataset.direction));
    if (action === "add-review-item") return addReviewItem(reviewScopeFromNode(actionNode));
    if (action === "add-review-reason") return addReviewReason(reviewScopeFromNode(actionNode), actionNode.closest("[data-review-id]").dataset.reviewId);
    if (action === "delete-review-reason") return confirmDelete("确认要删除这个原因吗？", () => deleteReviewReason(reviewScopeFromNode(actionNode), actionNode.dataset.reviewId, actionNode.dataset.reasonId));
    if (action === "toggle-review-star") return toggleReviewStar(reviewScopeFromNode(actionNode), actionNode.closest("[data-review-id]").dataset.reviewId);
    if (action === "edit-review-item") return editReviewItem(actionNode.closest("[data-review-id]").dataset.reviewId);
    if (action === "save-review-item") return saveReviewItem(actionNode.closest("[data-review-id]"));
    if (action === "delete-review-item") return confirmDelete("确认要删除这条复盘吗？", () => deleteReviewItem(reviewScopeFromNode(actionNode), actionNode.closest("[data-review-id]").dataset.reviewId));
    if (action === "move-review-item") return moveReviewItem(reviewScopeFromNode(actionNode), actionNode.closest("[data-review-id]").dataset.reviewId, Number(actionNode.dataset.direction));
  });

  document.addEventListener("input", (event) => {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    if (action === "update-log") updateLog(actionNode.closest("[data-log-id]").dataset.logId, actionNode.dataset.field, actionNode.value, false);
    if (action === "update-location") updateLocationDraft(actionNode.closest("[data-location-id]").dataset.locationId, actionNode.dataset.field, actionNode.value, false);
    if (action === "update-habit") updateHabit(actionNode.closest("[data-habit-id]").dataset.habitId, actionNode.value, actionNode, false);
    if (action === "update-review-item") updateReviewItem(reviewScopeFromNode(actionNode), actionNode.closest("[data-review-id]").dataset.reviewId, actionNode.dataset.field, actionNode.value);
    if (action === "update-review-reason") updateReviewReason(reviewScopeFromNode(actionNode), actionNode.dataset.reviewId, actionNode.dataset.reasonId, actionNode.dataset.field, actionNode.value);
    if (action === "update-week-review") updateWeeklyReviewField(actionNode.dataset.weeklyReviewKey, actionNode.dataset.field, actionNode.value);
    if (action === "update-month-review") updateMonthlyReviewField(actionNode.dataset.monthReviewKey, actionNode.dataset.field, actionNode.value);
    if (action === "set-review-date") setReviewDate(actionNode.value);
    if (action === "set-scope-date") setScopeDate(actionNode.dataset.owner, actionNode.dataset.scope, actionNode.value);
    if (action === "set-review-scope-date") setReviewScopeDate(actionNode.dataset.reviewScope, actionNode.value);
  });

  document.addEventListener("change", (event) => {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    if (actionNode.dataset.action === "update-log") {
      updateLog(actionNode.closest("[data-log-id]").dataset.logId, actionNode.dataset.field, actionNode.value, actionNode.dataset.field !== "note");
    }
    if (actionNode.dataset.action === "update-location") {
      updateLocationDraft(actionNode.closest("[data-location-id]").dataset.locationId, actionNode.dataset.field, actionNode.value, false);
    }
    if (actionNode.dataset.action === "update-habit") {
      updateHabit(actionNode.closest("[data-habit-id]").dataset.habitId, actionNode.value, actionNode, true);
    }
    if (actionNode.dataset.action === "toggle-subtask-done") {
      const row = actionNode.closest("[data-subtask-id]");
      setSubtaskDone(row.dataset.targetId, row.dataset.subtaskId, actionNode.checked);
    }
    if (actionNode.dataset.action === "set-scope-date") {
      setScopeDate(actionNode.dataset.owner, actionNode.dataset.scope, actionNode.value);
    }
    if (actionNode.dataset.action === "set-review-scope-date") {
      setReviewScopeDate(actionNode.dataset.reviewScope, actionNode.value);
    }
  });

  $("#global-date").addEventListener("change", (event) => {
    const nextDate = normalizeDateKey(event.target.value);
    if (!nextDate) {
      event.target.value = dateKey();
      return;
    }
    setState((draft) => {
      clearRecordDrafts();
      draft.date = nextDate;
    });
  });

  $("#global-date-picker")?.addEventListener("change", (event) => {
    const nextDate = normalizeDateKey(event.target.value);
    if (!nextDate) return;
    setState((draft) => {
      clearRecordDrafts();
      draft.date = nextDate;
    });
  });

  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      setState((draft) => {
        if (draft.activeTab !== button.dataset.tab) clearRecordDrafts();
        draft.activeTab = button.dataset.tab;
      });
    });
  });

  function addLocationRecord() {
    const id = uid();
    ui.editingLocations.add(id);
    ui.locationDrafts.set(id, {
      id,
      date: dateKey(),
      type: "",
      start: "",
      end: "",
    });
    render();
  }

  function editLocationRecord(locationId) {
    const entry = locationEntriesForDate().find((item) => item.id === locationId);
    if (entry) ui.locationDrafts.set(locationId, { ...entry, date: dateKey() });
    ui.editingLocations.add(locationId);
    render();
  }

  function updateLocationDraft(locationId, field, value) {
    const draft = ui.locationDrafts.get(locationId);
    if (!draft) return;
    draft[field] = value;
  }

  function saveLocationRecord(locationNode) {
    const locationId = locationNode.dataset.locationId;
    const draft = ui.locationDrafts.get(locationId);
    if (!draft) return;
    if (!draft.type || (!draft.start && !draft.end)) {
      alert("请先选择地点，并至少填写开始或结束时间。");
      return;
    }
    setState((stateDraft) => {
      persistLocationEntry(stateDraft, draft);
    });
    ui.locationDrafts.delete(locationId);
    ui.editingLocations.delete(locationId);
    render();
  }

  function requestDeleteLocation(locationNode) {
    const locationId = locationNode.dataset.locationId;
    const draft = ui.locationDrafts.get(locationId);
    const remove = () => {
      ui.editingLocations.delete(locationId);
      ui.locationDrafts.delete(locationId);
      if (draft && locationNode.dataset.draft === "true") {
        render();
        return;
      }
      deleteLocationRecord(locationId);
    };
    if (locationNode.dataset.draft === "true") remove();
    else confirmDelete("确认要删除这条地点时间吗？", remove);
  }

  function deleteLocationRecord(locationId) {
    setState((draft) => {
      const entry = locationEntriesForDate().find((item) => item.id === locationId);
      if (!entry) return;
      persistLocationEntry(draft, { ...entry, type: "", date: dateKey() });
    });
  }

  function addLog(segmentId) {
    const id = uid();
    ui.editingLogs.add(id);
    const tag = state.settings.tags[0];
    ui.logDrafts.set(id, {
      id,
      date: dateKey(),
      segmentId,
      tagId: tag.id,
      subtag: tag.subtags[0] || "",
      minutes: 60,
      note: "",
    });
    render();
  }

  function editLog(logId) {
    const log = logsForDate().find((entry) => entry.id === logId);
    if (log) ui.logDrafts.set(logId, { ...log, date: dateKey() });
    ui.editingLogs.add(logId);
    render();
  }

  function saveLog(logNode) {
    const logId = logNode.dataset.logId;
    const logDraft = ui.logDrafts.get(logId);
    if (logDraft) {
      setState((draft) => {
        draft.logs[logDraft.date] ||= [];
        const { date, ...logData } = logDraft;
        const index = draft.logs[logDraft.date].findIndex((entry) => entry.id === logId);
        if (index >= 0) draft.logs[logDraft.date][index] = logData;
        else draft.logs[logDraft.date].push(logData);
      });
      ui.logDrafts.delete(logId);
    }
    ui.editingLogs.delete(logId);
    render();
  }

  function shiftDate(days) {
    const current = new Date(`${dateKey()}T00:00:00`);
    current.setDate(current.getDate() + days);
    setState((draft) => {
      clearRecordDrafts();
      draft.date = isoFromDate(current);
    });
  }

  function shiftScopeDate(owner, direction) {
    const scope = owner === "review" ? state.reviewScope : state.targetScope;
    const current = new Date(`${dateKey()}T00:00:00`);
    if (scope === "day") current.setDate(current.getDate() + direction);
    if (scope === "week") current.setDate(current.getDate() + direction * 7);
    if (scope === "month") current.setMonth(current.getMonth() + direction);
    setState((draft) => {
      clearRecordDrafts();
      draft.date = isoFromDate(current);
    });
  }

  function setSummaryMode(owner, mode) {
    if (!["task", "location"].includes(mode)) return;
    if (owner === "review") ui.reviewSummaryMode = mode;
    else ui.recordSummaryMode = mode;
    render();
  }

  function setRecordSummaryScope(scope) {
    if (!["day", "week", "month"].includes(scope)) return;
    ui.recordSummaryScope = scope;
    render();
  }

  function toggleSummaryOther(owner, checked) {
    if (owner === "review") ui.reviewSummaryIncludeOther = checked;
    else ui.recordSummaryIncludeOther = checked;
    render();
  }

  function setMonthReviewMode(mode) {
    if (!["red", "green", "summary"].includes(mode)) return;
    ui.monthReviewMode = mode;
    render();
  }

  function toggleKeyEventDetail(key) {
    if (!key) return;
    if (ui.expandedKeyEvents.has(key)) ui.expandedKeyEvents.delete(key);
    else ui.expandedKeyEvents.add(key);
    render();
  }

  function updateLog(logId, field, value, shouldRender = true) {
    const log = ui.logDrafts.get(logId);
    if (!log) return;
    if (field === "minutes") log[field] = Math.max(0, Number(value) || 0);
    else log[field] = value;
    if (field === "tagId") {
      const tag = getTag(value);
      log.subtag = tag?.subtags?.[0] || "";
    }
    if (shouldRender) render();
  }

  function deleteLog(logId) {
    setState((draft) => {
      draft.logs[dateKey()] = logsForDate().filter((entry) => entry.id !== logId);
    });
  }

  function requestDeleteLog(logNode) {
    const logId = logNode.dataset.logId;
    const isDraft = logNode.dataset.draft === "true";
    confirmDelete("确认要删除这条记录吗？", () => {
      ui.editingLogs.delete(logId);
      ui.logDrafts.delete(logId);
      if (isDraft) render();
      else deleteLog(logId);
    });
  }

  function clearLogDrafts() {
    ui.logDrafts.clear();
    ui.editingLogs.clear();
  }

  function clearLocationDrafts() {
    ui.locationDrafts.clear();
    ui.editingLocations.clear();
  }

  function clearRecordDrafts() {
    clearLogDrafts();
    clearLocationDrafts();
  }

  function toggleEditMode(key) {
    ui[key] = !ui[key];
    if (key === "recordEditing" && !ui[key]) clearRecordDrafts();
    if (key === "reviewEditing" && !ui[key]) ui.editingReviews.clear();
    render();
  }

  function toggleTarget(targetId) {
    setState(() => {
      const target = getTarget(targetId);
      if (!target) return;
      const collapsed = target.collapsed !== false;
      target.collapsed = !collapsed;
    });
  }

  function setTargetFilter(tag) {
    ui.targetFilterTag = tag || "__all";
    if (tag && tag !== "__all") ui.collapsedTargetTags.delete(tag);
    render();
  }

  function toggleTargetCategory(tag) {
    if (!tag) return;
    if (ui.collapsedTargetTags.has(tag)) ui.collapsedTargetTags.delete(tag);
    else ui.collapsedTargetTags.add(tag);
    render();
  }

  function deleteTarget(targetId) {
    setState((draft) => {
      const list = targetsForScopeDraft(draft, state.targetScope, scopeKey(state.targetScope));
      const index = list.findIndex((item) => item.id === targetId);
      if (index >= 0) list.splice(index, 1);
    });
  }

  function migrateTarget(targetId) {
    const source = getTarget(targetId);
    if (!source) {
      alert("没有找到可迁移的目标。");
      return;
    }
    const targetDate = nextScopeDate(state.targetScope, dateKey());
    const targetKey = scopeKey(state.targetScope, targetDate);
    setState((draft) => {
      const list = targetsForScopeDraft(draft, state.targetScope, targetKey);
      list.push(cloneTargetForMigration(source));
    });
    alert(`已将“${source.name || "未命名目标"}”迁移到 ${scopeDisplay(state.targetScope, targetDate)}。`);
  }

  function migrateIncompleteTargets() {
    const sourceDate = dateKey();
    const sources = targetsForCurrentScope().filter((target) => !isTaskDone(target));
    if (!sources.length) {
      alert("今日没有需要迁移的未完成目标。");
      return;
    }
    const targetDate = nextScopeDate("day", sourceDate);
    setState((draft) => {
      draft.targetMigrations ||= {};
      draft.targetMigrations[sourceDate] = { targetDate };
    });
    alert(`已将 ${sources.length} 个未完成目标迁移到 ${scopeDisplay("day", targetDate)}。`);
  }

  function nextScopeDate(scope, date) {
    const next = new Date(`${date}T00:00:00`);
    if (scope === "day") next.setDate(next.getDate() + 1);
    if (scope === "week") next.setDate(next.getDate() + 7);
    if (scope === "month") next.setMonth(next.getMonth() + 1);
    return isoFromDate(next);
  }

  function syncTargetMigration(draft, sourceDate) {
    if (!sourceDate) return;
    draft.targetMigrations ||= {};
    const migration = draft.targetMigrations[sourceDate];
    if (!migration) return;
    const targetDate = migration.targetDate || nextScopeDate("day", sourceDate);
    migration.targetDate = targetDate;
    const sourceKey = scopeKey("day", sourceDate);
    const targetKey = scopeKey("day", targetDate);
    const sourceList = targetsForScopeDraft(draft, "day", sourceKey);
    const targetList = targetsForScopeDraft(draft, "day", targetKey);
    for (let index = targetList.length - 1; index >= 0; index -= 1) {
      if (targetList[index]?.migration?.sourceDate === sourceDate) targetList.splice(index, 1);
    }
    sourceList.filter((target) => !isTaskDone(target)).forEach((target) => {
      targetList.push(cloneTargetForMigration(target, sourceDate));
    });
  }

  function cloneTargetForMigration(target, completedDate = dateKey()) {
    return {
      ...structuredClone(target),
      id: uid(),
      startedAt: target.startedAt || completedDate,
      collapsed: true,
      migration: {
        sourceDate: completedDate,
        sourceTargetId: target.id,
      },
      children: (target.children || []).map((item) => cloneSubtaskForMigration(item, completedDate)),
    };
  }

  function cloneSubtaskForMigration(item, completedDate = dateKey()) {
    const done = isSubtaskDone(item);
    return {
      ...structuredClone(item),
      id: uid(),
      completedAt: done ? item.completedAt || completedDate : item.completedAt || "",
      children: (item.children || []).map((child) => cloneSubtaskForMigration(child, completedDate)),
    };
  }

  function stepProgress(targetId, subtaskId, delta) {
    setState(() => {
      const target = getTarget(targetId);
      const item = subtaskId ? findChild(target, subtaskId) : target;
      if (!item) return;
      item.done = clamp((item.done || 0) + delta, 0, item.total || 1);
      if (item.done >= (item.total || 1)) item.completedAt = item.completedAt || dateKey();
      else item.completedAt = "";
    });
  }

  function setSubtaskDone(targetId, subtaskId, checked) {
    setState(() => {
      const target = getTarget(targetId);
      const item = findChild(target, subtaskId);
      if (!item) return;
      item.done = checked ? item.total || 1 : 0;
      item.completedAt = checked ? item.completedAt || dateKey() : "";
      (item.children || []).forEach((child) => {
        child.done = checked ? child.total || 1 : 0;
        child.completedAt = checked ? child.completedAt || dateKey() : "";
      });
    });
  }

  function updateHabit(habitId, value, sourceNode = null, shouldRender = true) {
    const habit = getHabit(habitId);
    if (!habit) return;
    habit.records ||= {};
    const percent = clamp(Number(value) || 0, 0, 100);
    habit.records[dateKey()] = percent;
    saveState();
    if (sourceNode) {
      const panel = sourceNode.closest("[data-habit-id]");
      const titleHint = $(".habit-row .hint", panel);
      $$("[data-action='update-habit']", panel).forEach((input) => {
        if (input !== sourceNode) input.value = percent;
      });
      if (titleHint) titleHint.textContent = `今日 ${percent}%`;
    }
    if (shouldRender) render();
  }

  function deleteHabit(habitId) {
    setState((draft) => {
      draft.habits = draft.habits.filter((habit) => habit.id !== habitId);
    });
  }

  function setReviewDate(value) {
    if (!value) return;
    setState((draft) => {
      draft.date = value.length === 7 ? `${value}-01` : value;
    });
  }

  function setScopeDate(owner, scope, value) {
    const nextDate = normalizeScopePickerValue(scope, value);
    if (!nextDate) return;
    setState((draft) => {
      clearRecordDrafts();
      draft.date = nextDate;
      if (owner === "target") draft.targetScope = "day";
    });
  }

  function setReviewScopeDate(scope, value) {
    const nextDate = normalizeScopePickerValue(scope, value);
    if (!nextDate) return;
    setState((draft) => {
      draft.reviewDates ||= {};
      draft.reviewDates[scope] = nextDate;
    });
  }

  function shiftReviewDate(scope, direction) {
    if (!["day", "week", "month"].includes(scope)) return;
    const current = new Date(`${reviewDate(scope)}T00:00:00`);
    if (scope === "day") current.setDate(current.getDate() + direction);
    if (scope === "week") current.setDate(current.getDate() + direction * 7);
    if (scope === "month") current.setMonth(current.getMonth() + direction);
    setState((draft) => {
      draft.reviewDates ||= {};
      draft.reviewDates[scope] = isoFromDate(current);
    });
  }

  function reviewScopeFromNode(node) {
    return node.dataset.reviewScope || node.closest("[data-review-scope]")?.dataset.reviewScope || state.reviewScope || "day";
  }

  function addReviewItem(scope = state.reviewScope) {
    const id = uid();
    ui.editingReviews.add(id);
    setState((draft) => {
      const list = reviewsForScopeDraft(draft, scope, scopeKey(scope, reviewDate(scope)));
      list.push({ id, phenomenon: "", starred: false, reasons: [{ id: uid(), text: "", measure: "" }] });
    });
  }

  function addReviewReason(scope, itemId) {
    setState(() => {
      const item = reviewsForScope(scope).find((review) => review.id === itemId);
      if (!item) return;
      item.reasons ||= [];
      item.reasons.push({ id: uid(), text: "", measure: "" });
    });
  }

  function editReviewItem(itemId) {
    ui.editingReviews.add(itemId);
    render();
  }

  function saveReviewItem(itemNode) {
    const itemId = itemNode.dataset.reviewId;
    ui.editingReviews.delete(itemId);
    render();
  }

  function updateReviewItem(scope, itemId, field, value) {
    const item = reviewsForScope(scope).find((review) => review.id === itemId);
    if (!item) return;
    item[field] = value;
    saveState();
  }

  function updateReviewReason(scope, itemId, reasonId, field, value) {
    const item = reviewsForScope(scope).find((review) => review.id === itemId);
    const reason = item?.reasons?.find((entry) => entry.id === reasonId);
    if (!reason) return;
    reason[field] = value;
    saveState();
  }

  function toggleReviewStar(scope, itemId) {
    if (scope !== "day") return;
    setState(() => {
      const item = reviewsForScope("day", reviewDate("day")).find((review) => review.id === itemId);
      if (item) item.starred = !item.starred;
    });
  }

  function updateWeeklyReviewField(key, field, value) {
    if (!["red", "green", "nextDirection"].includes(field)) return;
    const review = weeklyReviewForKey(key || scopeKey("week", reviewDate("week")));
    review[field] = value;
    saveState();
  }

  function updateMonthlyReviewField(key, field, value) {
    if (!["redInsight", "greenInsight", "nextDirection"].includes(field)) return;
    const review = monthlyReviewForKey(key || scopeKey("month", reviewDate("month")));
    review[field] = value;
    saveState();
  }

  function deleteReviewReason(scope, itemId, reasonId) {
    setState(() => {
      const item = reviewsForScope(scope).find((review) => review.id === itemId);
      if (!item?.reasons) return;
      item.reasons = item.reasons.filter((reason) => reason.id !== reasonId);
      if (!item.reasons.length) item.reasons.push({ id: uid(), text: "", measure: "" });
    });
  }

  function deleteReviewItem(scope, itemId) {
    setState((draft) => {
      const list = reviewsForScopeDraft(draft, scope, scopeKey(scope, reviewDate(scope)));
      const index = list.findIndex((review) => review.id === itemId);
      if (index >= 0) list.splice(index, 1);
    });
  }

  function deletePlan(index) {
    setState((draft) => {
      draft.settings.plans.splice(index, 1);
    });
  }

  function moveLog(logId, direction) {
    setState((draft) => {
      const list = draft.logs[dateKey()] || [];
      const current = list.find((entry) => entry.id === logId);
      if (!current) return;
      moveInFilteredList(list, (entry) => entry.segmentId === current.segmentId, logId, direction);
    });
  }

  function moveTarget(targetId, direction) {
    setState((draft) => {
      moveInListById(targetsForScopeDraft(draft, state.targetScope, scopeKey(state.targetScope)), targetId, direction);
    });
  }

  function moveHabit(habitId, direction) {
    setState((draft) => {
      moveInListById(draft.habits, habitId, direction);
    });
  }

  function movePlan(index, direction) {
    setState((draft) => {
      const target = index + direction;
      if (target < 0 || target >= draft.settings.plans.length) return;
      [draft.settings.plans[index], draft.settings.plans[target]] = [draft.settings.plans[target], draft.settings.plans[index]];
    });
  }

  function moveReviewItem(scope, itemId, direction) {
    setState((draft) => {
      moveInListById(reviewsForScopeDraft(draft, scope, scopeKey(scope, reviewDate(scope))), itemId, direction);
    });
  }

  function moveSubtask(targetId, subtaskId, direction) {
    setState((draft) => {
      const target = targetsForScopeDraft(draft, state.targetScope, scopeKey(state.targetScope)).find((item) => item.id === targetId);
      const collection = findChildCollection(target, subtaskId);
      if (collection) moveInListById(collection, subtaskId, direction);
    });
  }

  function moveInFilteredList(list, predicate, id, direction) {
    const indexes = list.map((item, index) => (predicate(item) ? index : null)).filter((index) => index !== null);
    const position = indexes.findIndex((index) => list[index].id === id);
    const nextPosition = position + direction;
    if (position < 0 || nextPosition < 0 || nextPosition >= indexes.length) return;
    const from = indexes[position];
    const to = indexes[nextPosition];
    [list[from], list[to]] = [list[to], list[from]];
  }

  function moveInListById(list, id, direction) {
    const index = list.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
  }

  function findChildCollection(target, childId) {
    if (!target?.children) return null;
    if (target.children.some((item) => item.id === childId)) return target.children;
    for (const child of target.children) {
      const found = findChildCollection(child, childId);
      if (found) return found;
    }
    return null;
  }

  function togglePlanEdit() {
    ui.plansEditing = !ui.plansEditing;
    render();
  }

  function getTag(tagId) {
    return state.settings.tags.find((tag) => tag.id === tagId);
  }

  function getTarget(targetId) {
    return targetsForCurrentScope().find((target) => target.id === targetId);
  }

  function getHabit(habitId) {
    return state.habits.find((habit) => habit.id === habitId);
  }

  function findChild(target, childId) {
    if (!target || !childId) return null;
    const stack = [...(target.children || [])];
    while (stack.length) {
      const item = stack.shift();
      if (item.id === childId) return item;
      stack.push(...(item.children || []));
    }
    return null;
  }

  function getTotals(logs) {
    return logs.reduce((acc, entry) => {
      acc[entry.tagId] = (acc[entry.tagId] || 0) + (Number(entry.minutes) || 0);
      return acc;
    }, {});
  }

  function totalsForReviewScope() {
    const dates = datesInScope(state.reviewScope, dateKey());
    return dates.reduce((acc, date) => {
      for (const [tagId, minutes] of Object.entries(getTotals(state.logs[date] || []))) {
        acc[tagId] = (acc[tagId] || 0) + minutes;
      }
      return acc;
    }, {});
  }

  function totalsForLogScope(scope, date = dateKey()) {
    return datesInScope(scope, date).reduce((acc, itemDate) => {
      for (const [tagId, minutes] of Object.entries(getTotals(state.logs[itemDate] || []))) {
        acc[tagId] = (acc[tagId] || 0) + minutes;
      }
      return acc;
    }, {});
  }

  function habitRateForScope(scope = state.reviewScope, date = dateKey()) {
    if (!state.habits.length) return 0;
    const dates = datesInScope(scope, date);
    let total = 0;
    let completed = 0;
    state.habits.forEach((habit) => {
      dates.forEach((date) => {
        total += 1;
        if ((Number(habit.records?.[date]) || 0) > 0) completed += 1;
      });
    });
    return total ? Math.round((completed / total) * 100) : 0;
  }

  function weeklyReviewForKey(key) {
    state.weeklyReviews ||= {};
    state.weeklyReviews[key] = normalizeWeeklyReview(state.weeklyReviews[key]);
    return state.weeklyReviews[key];
  }

  function readWeeklyReviewForKey(key) {
    return normalizeWeeklyReview(state.weeklyReviews?.[key] || {});
  }

  function normalizeWeeklyReview(review = {}) {
    return {
      red: review.red || "",
      green: review.green || "",
      nextDirection: review.nextDirection || review.direction || "",
    };
  }

  function monthlyReviewForKey(key) {
    state.monthlyReviews ||= {};
    state.monthlyReviews[key] = normalizeMonthlyReview(state.monthlyReviews[key]);
    return state.monthlyReviews[key];
  }

  function normalizeMonthlyReview(review = {}) {
    return {
      redInsight: review.redInsight || review.red || "",
      greenInsight: review.greenInsight || review.green || "",
      nextDirection: review.nextDirection || review.direction || "",
    };
  }

  function weeklyStudySummary(date) {
    return studySummaryForDates(datesInScope("week", date));
  }

  function weeklyWorkSummary(date) {
    return workSummaryForDates(datesInScope("week", date));
  }

  function weeklyStudyBreakdown(date) {
    return studyBreakdownForDates(datesInScope("week", date));
  }

  function monthlyStudyBreakdown(date) {
    return studyBreakdownForDates(datesInScope("month", date));
  }

  function studySummaryForDates(dates) {
    const studyTag = getStudyTag();
    if (!studyTag) return { total: 0, recordedDays: 0 };
    return dates.reduce(
      (acc, itemDate) => {
        const logs = state.logs[itemDate] || [];
        const hasAnyRecord = logs.some((entry) => Number(entry.minutes) > 0);
        if (hasAnyRecord) acc.recordedDays += 1;
        acc.total += logs
          .filter((entry) => entry.tagId === studyTag.id)
          .reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
        return acc;
      },
      { total: 0, recordedDays: 0 },
    );
  }

  function workSummaryForDates(dates) {
    return dates.reduce(
      (acc, itemDate) => {
        if (hasCompleteLocationRecord(itemDate)) acc.recordedDays += 1;
        acc.total += locationTotalsForDay(itemDate).__loc_work || 0;
        return acc;
      },
      { total: 0, recordedDays: 0 },
    );
  }

  function studyBreakdownForDates(dates) {
    const studyTag = getStudyTag();
    if (!studyTag) return { total: 0, entries: [] };
    const totals = new Map();
    dates.forEach((itemDate) => {
      (state.logs[itemDate] || [])
        .filter((entry) => entry.tagId === studyTag.id && Number(entry.minutes) > 0)
        .forEach((entry) => {
          const label = entry.subtag || "未分类";
          totals.set(label, (totals.get(label) || 0) + (Number(entry.minutes) || 0));
        });
    });
    const orderedLabels = [
      ...(studyTag.subtags || []).filter((label) => totals.has(label)),
      ...Array.from(totals.keys()).filter((label) => !(studyTag.subtags || []).includes(label)),
    ];
    const total = sumMinutes(Array.from(totals.values()));
    const entries = orderedLabels.map((label, index) => ({
      label,
      minutes: totals.get(label) || 0,
      percent: total ? Math.round(((totals.get(label) || 0) / total) * 100) : 0,
      color: weeklyBreakdownColor(index, studyTag.color),
    }));
    return { total, entries };
  }

  function monthWeekBuckets(date) {
    const buckets = [];
    const monthStart = scopeKey("month", date);
    const nextMonthDate = new Date(`${monthStart}T00:00:00`);
    nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
    const firstWeekKey = scopeKey("week", monthStart);
    const nextMonthFirstWeekKey = scopeKey("week", isoFromDate(nextMonthDate));
    let cursor = new Date(`${firstWeekKey}T00:00:00`);
    while (isoFromDate(cursor) !== nextMonthFirstWeekKey) {
      const key = isoFromDate(cursor);
      buckets.push({ key, dates: datesInScope("week", key) });
      cursor.setDate(cursor.getDate() + 7);
    }
    return buckets;
  }

  function keyEventsForDates(dates) {
    return dates.flatMap((itemDate) => {
      const items = state.reviews.day?.[scopeKey("day", itemDate)] || [];
      return items
        .map(normalizeReviewItem)
        .filter((item) => item.starred)
        .map((item) => ({
          key: `${itemDate}:${item.id}`,
          date: itemDate,
          id: item.id,
          phenomenon: item.phenomenon,
          reasons: item.reasons || [],
        }));
    });
  }

  function getStudyTag() {
    return state.settings.tags.find((tag) => tag.name === "学习") || state.settings.tags.find((tag) => tag.id === "study") || state.settings.tags.find((tag) => tag.name?.includes("学习"));
  }

  function hasCompleteLocationRecord(date) {
    return locationEntriesForDate(date).some((entry) => entry.type && entry.start && entry.end);
  }

  function weeklyBreakdownColor(index, baseColor = colors[0]) {
    return [baseColor, "#4e7fa8", "#b35d4a", "#8a7b35", "#7d5f89", "#4d7d4d", "#a55567"][index % 7];
  }

  function datesInScope(scope, date) {
    const start = new Date(`${scopeKey(scope, date)}T00:00:00`);
    const count = scope === "day" ? 1 : scope === "week" ? 7 : new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const d = new Date(start);
      d.setDate(start.getDate() + index);
      return isoFromDate(d);
    });
  }

  function minutesInScope(scope) {
    return baselineDaysInScope(scope) * 24 * 60;
  }

  function baselineDaysInScope(scope) {
    if (scope === "week") return 7;
    if (scope === "month") return 30;
    return 1;
  }

  function targetProgress(target) {
    if (!target.hasProgress) return { done: 0, total: 0, percent: 0 };
    const items = getProgressItems(target);
    const done = items.reduce((sum, item) => sum + Math.min(item.done || 0, item.total || 1), 0);
    const total = items.reduce((sum, item) => sum + (item.total || 1), 0) || 1;
    return { done, total, percent: Math.round((done / total) * 100) };
  }

  function getProgressItems(target) {
    const children = target.children || [];
    if (!children.length) return [target];
    const items = [];
    const visit = (item) => {
      if (item.children?.length) {
        item.children.forEach(visit);
        return;
      }
      if (item.hasProgress !== false) items.push(item);
    };
    children.forEach(visit);
    return items.length ? items : [target];
  }

  function isTaskDone(target) {
    if (!target.hasProgress) return false;
    const progress = targetProgress(target);
    return progress.total > 0 && progress.done >= progress.total;
  }

  function isSubtaskDone(item) {
    return item.hasProgress !== false && (item.done || 0) >= (item.total || 1);
  }

  function targetTag(target) {
    const tag = String(target?.tag || target?.category || "").trim();
    return tag || "未分类";
  }

  function defaultTargetTag(sourceState = state) {
    return normalizedTargetDefaultTag(sourceState.settings?.targetDefaultTag, sourceState.settings?.targetTags || []);
  }

  function targetTagList(targets = targetsForCurrentScope()) {
    const tags = [...(state.settings.targetTags || []), ...targets.map(targetTag)].map((tag) => String(tag || "").trim()).filter(Boolean);
    return orderTargetTags(tags.length ? tags : ["未分类"]);
  }

  function targetTagListFromState(sourceState) {
    const tags = [...(sourceState.settings?.targetTags || [])];
    Object.values(sourceState.targets || {}).forEach((collections) => {
      Object.values(collections || {}).forEach((items) => {
        (items || []).forEach((target) => tags.push(targetTag(target)));
      });
    });
    const normalizedTags = tags.map((tag) => String(tag || "").trim()).filter(Boolean);
    return orderTargetTags(normalizedTags.length ? normalizedTags : ["未分类"]);
  }

  function orderTargetTags(tags) {
    const unique = [];
    tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean)
      .forEach((tag) => {
        if (!unique.includes(tag) && tag !== "未分类") unique.push(tag);
      });
    return [...unique, "未分类"];
  }

  function normalizedTargetDefaultTag(tag, tags) {
    const value = String(tag || "").trim() || "未分类";
    return orderTargetTags(tags || ["未分类"]).includes(value) ? value : "未分类";
  }

  function renameTargetTags(draft, renameMap, keptOriginals) {
    const nextTags = new Set(draft.settings.targetTags || []);
    Object.values(draft.targets || {}).forEach((collections) => {
      Object.values(collections || {}).forEach((items) => {
        (items || []).forEach((target) => {
          const original = targetTag(target);
          if (renameMap.has(original)) target.tag = renameMap.get(original) || "未分类";
          else if (original !== "未分类" && !keptOriginals.has(original) && !nextTags.has(original)) target.tag = "未分类";
        });
      });
    });
    if (renameMap.has(ui.targetFilterTag)) ui.targetFilterTag = renameMap.get(ui.targetFilterTag) || "__all";
    if (ui.targetFilterTag !== "__all" && !nextTags.has(ui.targetFilterTag)) ui.targetFilterTag = "__all";
  }

  function executionDays(target) {
    const start = new Date(`${target.startedAt || dateKey()}T00:00:00`);
    const current = new Date(`${dateKey()}T00:00:00`);
    const diff = Math.floor((current - start) / 86400000);
    return Math.max(0, diff);
  }

  function shortDateText(date) {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
  }

  function targetsForScopeDraft(draft, scope, key) {
    draft.targets[scope] ||= {};
    draft.targets[scope][key] ||= [];
    return draft.targets[scope][key];
  }

  function reviewsForScopeDraft(draft, scope, key) {
    draft.reviews[scope] ||= {};
    draft.reviews[scope][key] ||= [];
    return draft.reviews[scope][key];
  }

  function scopeLabel(scope) {
    return { day: "日目标", week: "周目标", month: "月目标" }[scope];
  }

  function summaryScopeTitle(scope) {
    return { day: "今日汇总", week: "本周汇总", month: "本月汇总" }[scope] || "汇总";
  }

  function summaryScopeShortLabel(scope) {
    return { day: "今日", week: "本周", month: "本月" }[scope] || "今日";
  }

  function recordSummaryHint(scope) {
    const totals = totalsForLogScope(scope, dateKey());
    return `已记录 ${formatDuration(sumMinutes(Object.values(totals)))} / ${formatDuration(minutesInScope(scope))}`;
  }

  function reviewLabel(scope) {
    return { day: "日复盘", week: "周复盘", month: "月复盘" }[scope];
  }

  function scopeDisplay(scope, date = dateKey()) {
    const key = scopeKey(scope, date);
    if (scope === "day") return key;
    if (scope === "week") {
      const end = new Date(`${key}T00:00:00`);
      end.setDate(end.getDate() + 6);
      return `${key} 至 ${isoFromDate(end)}`;
    }
    return `${key.slice(0, 7)}`;
  }

  function scopeSwitchLabel(scope) {
    return { day: "日期", week: "周", month: "月份" }[scope] || "日期";
  }

  function scopePickerType(scope) {
    return scope === "month" ? "month" : "date";
  }

  function scopePickerValue(scope, date = dateKey()) {
    return scope === "month" ? scopeKey("month", date).slice(0, 7) : date;
  }

  function normalizeScopePickerValue(scope, value) {
    if (scope === "month") {
      const text = String(value || "").trim();
      return /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : "";
    }
    return normalizeDateKey(value);
  }

  function weekdayText(date) {
    const day = new Date(`${date}T00:00:00`).getDay();
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day];
  }

  function normalizeDateKey(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const parsed = new Date(`${text}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return "";
    return isoFromDate(parsed) === text ? text : "";
  }

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || "00:00").split(":").map(Number);
    return clamp((hours || 0) * 60 + (minutes || 0), 0, 1439);
  }

  function minutesToTime(value) {
    const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function locationLabel(type) {
    return { dorm: "宿舍", work: "工位", outdoor: "户外" }[type] || "户外";
  }

  function locationColor(type) {
    return { dorm: "#4d8b57", work: "#4e7fa8", outdoor: "#d8b74e" }[type] || colors[0];
  }

  function formatLocationRange(entry) {
    return `${entry.start || ""} - ${entry.end || ""}`;
  }

  function recordAxisRange() {
    const segments = state.settings.segments || defaults.settings.segments;
    const start = timeToMinutes(segments[0]?.start || "00:00");
    let end = timeToMinutes(segments[segments.length - 1]?.end || "23:59");
    if (end <= start) end += 1440;
    return { start, end };
  }

  function locationSlicesForRange(start, end, date = dateKey()) {
    const boundaries = new Set([start, end]);
    const intervals = locationIntervals(date);
    intervals.forEach((interval) => {
      [interval.start, interval.end, interval.start + 1440, interval.end + 1440].forEach((point) => {
        if (point > start && point < end) boundaries.add(point);
      });
    });
    const points = Array.from(boundaries).sort((a, b) => a - b);
    return points.slice(0, -1).map((point, index) => {
      const next = points[index + 1];
      const type = locationTypeAt((point + next) / 2, date, intervals);
      return {
        type,
        start: point,
        end: next,
        percent: ((next - point) / (end - start)) * 100,
      };
    });
  }

  function locationIntervals(date = dateKey()) {
    const locations = normalizeLocations(state.locationLogs?.[date] || {});
    return [
      ...locations.dorm.flatMap((row) => splitLocationRange("dorm", row.arrive, row.leave)),
      ...locations.work.flatMap((row) => splitLocationRange("work", row.arrive, row.leave)),
    ];
  }

  function normalizeLocations(locations = defaults.settings.locations) {
    if (Array.isArray(locations.work) || Array.isArray(locations.dorm)) {
      return {
        work: (locations.work || []).map(normalizeLocationRow).filter(Boolean),
        dorm: (locations.dorm || []).map(normalizeLocationRow).filter(Boolean),
      };
    }
    return {
      work: locations.workArrive && locations.workLeave ? [{ id: "work-imported", arrive: locations.workArrive, leave: locations.workLeave }] : [],
      dorm: locations.dormArrive && locations.dormLeave ? [{ id: "dorm-imported", arrive: locations.dormArrive, leave: locations.dormLeave }] : [],
    };
  }

  function normalizeLocationRecords(locations = {}) {
    if (Array.isArray(locations.work) || Array.isArray(locations.dorm)) {
      return {
        work: (locations.work || []).map(normalizeLocationRecordRow).filter(Boolean),
        dorm: (locations.dorm || []).map(normalizeLocationRecordRow).filter(Boolean),
      };
    }
    return normalizeLocations(locations);
  }

  function normalizeLocationRecordRow(row) {
    if (!row) return null;
    const arrive = row.arrive ?? row.start ?? "";
    const leave = row.leave ?? row.end ?? "";
    if (!arrive && !leave) return null;
    return {
      id: row.id || uid(),
      arrive,
      leave,
    };
  }

  function normalizeLocationRow(row) {
    if (!row?.arrive || !row?.leave || row.arrive === row.leave) return null;
    return {
      id: row.id || uid(),
      arrive: row.arrive,
      leave: row.leave,
    };
  }

  function locationEntriesForDate(date = dateKey(), source = null) {
    const locations = normalizeLocationRecords(source || state.locationLogs?.[date] || {});
    return [
      ...locations.work.map((row) => ({ id: row.id, type: "work", start: row.arrive, end: row.leave })),
      ...locations.dorm.map((row) => ({ id: row.id, type: "dorm", start: row.arrive, end: row.leave })),
    ].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }

  function persistLocationEntry(draft, entry) {
    draft.locationLogs ||= {};
    const date = entry.date || dateKey();
    const daily = normalizeLocationRecords(draft.locationLogs[date] || {});
    daily.work = daily.work.filter((row) => row.id !== entry.id);
    daily.dorm = daily.dorm.filter((row) => row.id !== entry.id);
    if (entry.type && (entry.start || entry.end)) {
      daily[entry.type].push({ id: entry.id, arrive: entry.start || "", leave: entry.end || "" });
    }
    draft.locationLogs[date] = daily;
  }

  function splitLocationRange(type, startValue, endValue) {
    const start = timeToMinutes(startValue);
    const end = timeToMinutes(endValue);
    if (start === end) return [];
    if (end > start) return [{ type, start, end }];
    return [
      { type, start, end: 1440 },
      { type, start: 0, end },
    ];
  }

  function locationTypeAt(minute, date = dateKey(), cachedIntervals = null) {
    const normalized = ((minute % 1440) + 1440) % 1440;
    const intervals = cachedIntervals || locationIntervals(date);
    const work = intervals.find((interval) => interval.type === "work" && normalized >= interval.start && normalized < interval.end);
    if (work) return "work";
    const dorm = intervals.find((interval) => interval.type === "dorm" && normalized >= interval.start && normalized < interval.end);
    if (dorm) return "dorm";
    return "outdoor";
  }

  function locationTotalsForScope(scope, date = dateKey()) {
    return datesInScope(scope, date).slice(0, baselineDaysInScope(scope)).reduce(
      (totals, itemDate) => {
        const daily = locationTotalsForDay(itemDate);
        totals.__loc_dorm += daily.__loc_dorm;
        totals.__loc_work += daily.__loc_work;
        totals.__loc_outdoor += daily.__loc_outdoor;
        return totals;
      },
      { __loc_dorm: 0, __loc_work: 0, __loc_outdoor: 0 },
    );
  }

  function locationTotalsForDay(date = dateKey()) {
    const slices = locationSlicesForRange(0, 1440, date);
    return slices.reduce(
      (totals, slice) => {
        totals[`__loc_${slice.type}`] += slice.end - slice.start;
        return totals;
      },
      { __loc_dorm: 0, __loc_work: 0, __loc_outdoor: 0 },
    );
  }

  function renderHabitTrail(habit) {
    return lastNDates(dateKey(), 7)
      .map((date) => renderHabitOrb(Number(habit.records?.[date]) || 0, habit.color || colors[0], true, true))
      .join("");
  }

  function habitTrailRangeText() {
    const dates = lastNDates(dateKey(), 7);
    return `${dates[0]} 至 ${dates[dates.length - 1]}`;
  }

  function renderHabitOrb(value, color = colors[0], small = false, showEmpty = false) {
    const percent = clamp(Number(value) || 0, 0, 100);
    if (percent <= 0) {
      return showEmpty ? `<span class="habit-empty-half" aria-label="未完成"></span>` : `<span class="habit-orb empty-orb" style="--habit-color:${color};--habit-size:${small ? 16 : 30}px;--habit-opacity:0.25" aria-label="完成度 0%"></span>`;
    }
    if (percent >= 100) {
      return `<span class="habit-flower" style="--habit-color:${color};--habit-size:${small ? 18 : 34}px" aria-label="完成度 100%"></span>`;
    }
    const min = small ? 7 : 10;
    const max = small ? 22 : 38;
    const size = Math.round(min + (max - min) * (percent / 100));
    return `<span class="habit-orb" style="--habit-color:${color};--habit-size:${size}px;--habit-opacity:0.88" aria-label="完成度 ${percent}%"></span>`;
  }

  function lastNDates(date, count) {
    const end = new Date(`${date}T00:00:00`);
    return Array.from({ length: count }, (_, index) => {
      const d = new Date(end);
      d.setDate(end.getDate() - (count - 1 - index));
      return isoFromDate(d);
    });
  }

  function reviewPlaceholders(scope) {
    const unit = scope === "week" ? "这周" : scope === "month" ? "这个月" : "今天";
    return {
      phenomenon: `可以先写${unit}遇到的问题，也可以写${unit}做得很好的事情`,
      reason: `遇到的问题是什么原因？做得好的事情是为什么可以做得好`,
      measure: "可以写一个对应措施，不填则展示时隐藏",
    };
  }

  function normalizeReviewItem(item) {
    const reasons = Array.isArray(item.reasons)
      ? item.reasons.map((reason) => ({
          id: reason.id || uid(),
          text: reason.text ?? reason.reason ?? "",
          measure: reason.measure || "",
        }))
      : [{ id: uid(), text: item.reason || "", measure: "" }];
    return {
      ...item,
      phenomenon: item.phenomenon ?? item.event ?? "",
      starred: Boolean(item.starred),
      reasons: reasons.length ? reasons : [{ id: uid(), text: "", measure: "" }],
    };
  }

  function formatDuration(minutes) {
    const rounded = Math.round(Number(minutes) || 0);
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    if (!hours) return `${mins}m`;
    if (!mins) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }

  function formatHourText(minutes) {
    const hours = (Number(minutes) || 0) / 60;
    if (!hours) return "0小时";
    const rounded = Math.round(hours * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}小时`;
  }

  function compactDateTime(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function sumMinutes(values) {
    return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function escapeMultiline(value) {
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function textareaRows(value) {
    const lines = String(value || "").split("\n").length;
    return clamp(lines || 2, 2, 6);
  }

  render();
  if (session?.access_token) {
    syncRemoteOnLogin()
      .then(render)
      .catch((error) => {
        console.warn(error);
        syncMeta.status = "error";
        syncMeta.message = error.message || "自动同步失败";
        render();
      });
  }
})();
