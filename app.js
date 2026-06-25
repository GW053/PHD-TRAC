(function () {
  const STORAGE_KEY = "today-flow-state-v1";
  const SESSION_KEY = "today-flow-supabase-session-v1";
  const SUPABASE_URL = "https://hgmpswhitmenyvnxotff.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WW3rmZCePegJsIf6LeqFvQ_KRgHD9pz";
  const SUPABASE_TABLE = "phd_trac_records";
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
    },
    logs: {},
    targets: {},
    habits: [],
    reviews: {},
  };

  let state = loadState();
  let session = loadSession();
  let remoteSaveTimer = null;
  let modalCleanup = null;
  const ui = {
    editingLogs: new Set(),
    logDrafts: new Map(),
    editingReviews: new Set(),
    recordEditing: false,
    targetEditing: false,
    habitEditing: false,
    reviewEditing: false,
    plansEditing: false,
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

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    queueRemoteSave();
  }

  function setState(mutator) {
    mutator(state);
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

  function targetsForCurrentScope() {
    state.targets[state.targetScope] ||= {};
    const key = scopeKey(state.targetScope);
    state.targets[state.targetScope][key] ||= [];
    return state.targets[state.targetScope][key];
  }

  function reviewsForCurrentScope() {
    state.reviews[state.reviewScope] ||= {};
    const key = scopeKey(state.reviewScope);
    state.reviews[state.reviewScope][key] ||= [];
    return state.reviews[state.reviewScope][key];
  }

  function render() {
    $("#global-date").value = dateKey();
    $(".date-row")?.classList.toggle("hidden", state.activeTab !== "record");
    const weekdayLabel = $("#weekday-label");
    if (weekdayLabel) weekdayLabel.textContent = weekdayText(dateKey());
    const loginButton = $("#login-button");
    if (loginButton) loginButton.textContent = session ? "已登录" : "登录";
    $$(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.activeTab);
    });
    if (state.activeTab === "record") renderRecord();
    if (state.activeTab === "execute") renderExecute();
    if (state.activeTab === "review") renderReview();
  }

  function renderRecord() {
    const logs = logsForDate();
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
        <div class="segment-grid">
          ${state.settings.segments.map((segment) => renderSegment(segment, logs)).join("")}
        </div>
        <section class="section-band today-summary">
          <div class="section-title compact-title">
            <div>
              <h2>今日汇总</h2>
              <p class="hint">${formatDuration(sumMinutes(Object.values(getTotals(logs))))}</p>
            </div>
          </div>
          <div class="data-summary compact-summary">
            ${renderPie(getTotals(logs))}
            <div class="stat-list">${renderStatRows(getTotals(logs))}</div>
          </div>
        </section>
      </section>
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
              <strong>${escapeHtml(tag?.name || "未分类")}${visibleEntry.subtag ? `-${escapeHtml(visibleEntry.subtag)}` : ""}</strong>
              ${
                ui.recordEditing
                  ? `<div class="row-actions">
                      <button class="move-button" type="button" data-action="move-log" data-direction="-1" aria-label="上移">▴</button>
                      <button class="move-button" type="button" data-action="move-log" data-direction="1" aria-label="下移">▾</button>
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
        <div class="entry-edit-grid entry-edit-actions">
          <input data-action="update-log" data-field="minutes" type="number" min="0" step="5" value="${visibleEntry.minutes || 0}" aria-label="分钟数" />
          <button class="icon-button danger-icon" type="button" data-action="delete-log" aria-label="删除">×</button>
          <button class="secondary-button" type="button" data-action="save-log">保存</button>
        </div>
        <textarea rows="${textareaRows(visibleEntry.note)}" data-action="update-log" data-field="note" placeholder="可填写任务内容及描述状态">${escapeHtml(visibleEntry.note || "")}</textarea>
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

  function renderPie(totals) {
    const entries = Object.entries(totals).filter(([, minutes]) => minutes > 0);
    const total = sumMinutes(Object.values(totals));
    if (!total) return `<div class="pie-wrap"><div class="pie" data-label="0h"></div></div>`;
    let cursor = 0;
    const parts = entries.map(([tagId, minutes], index) => {
      const start = (cursor / total) * 100;
      cursor += minutes;
      const end = (cursor / total) * 100;
      const tag = getTag(tagId);
      return `${tag?.color || colors[index % colors.length]} ${start}% ${end}%`;
    });
    return `<div class="pie-wrap"><div class="pie" data-label="${formatDuration(total)}" style="background: conic-gradient(${parts.join(",")})"></div></div>`;
  }

  function renderExecute() {
    const targets = targetsForCurrentScope();
    const sortedTargets = [...targets].sort((a, b) => Number(isTaskDone(a)) - Number(isTaskDone(b)));
    $("#app").innerHTML = `
      <section class="view" data-view="execute">
        <div class="section-band">
          <div class="section-title scope-header">
            <div>
              <h2>执行</h2>
              <p class="hint">切换日期和目标范围，拆分任务，按数量更新进度。</p>
            </div>
            <div class="button-row">
              <div class="target-tabs">
              ${["day", "week", "month"].map((scope) => `<button class="toggle-button ${state.targetScope === scope ? "active" : ""}" type="button" data-action="set-target-scope" data-scope="${scope}">${scopeLabel(scope)}</button>`).join("")}
              </div>
            </div>
          </div>
          ${renderScopeNavigator(state.targetScope, "target")}
        </div>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h2>${prettyScope(state.targetScope)}目标</h2>
              <p class="hint">${scopeDisplay(state.targetScope)}</p>
            </div>
            <div class="button-row">
              <button class="secondary-button add-button" type="button" data-action="add-target" aria-label="新增目标">+</button>
              <button class="primary-button" type="button" data-action="toggle-target-edit">${ui.targetEditing ? "完成" : "编辑"}</button>
            </div>
          </div>
          <div class="task-stack">
            ${sortedTargets.length ? sortedTargets.map((target) => renderTarget(target)).join("") : `<p class="empty">先添加一个目标，之后可以继续拆到二级和三级任务。</p>`}
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

  function renderTarget(target) {
    const progress = targetProgress(target);
    const done = isTaskDone(target);
    return `
      <article class="task-group ${done ? "done" : ""}" data-target-id="${target.id}">
        <div class="task-header">
          <div class="task-title-wrap">
            <div class="task-title-line">
              <h3 class="task-title">
                <button class="icon-button" type="button" data-action="toggle-target" aria-label="展开或收起">${target.collapsed ? "▸" : "▾"}</button>
                <span>${escapeHtml(target.name)}</span>
              </h3>
              ${
                ui.targetEditing
                  ? `<div class="row-actions">
                      <button class="move-button" type="button" data-action="move-target" data-direction="-1" aria-label="上移">▴</button>
                      <button class="move-button" type="button" data-action="move-target" data-direction="1" aria-label="下移">▾</button>
                      <button class="secondary-button" type="button" data-action="edit-target">编辑</button>
                    </div>`
                  : ""
              }
            </div>
            ${target.description ? `<p class="task-description">${escapeMultiline(target.description)}</p>` : ""}
            ${target.hasProgress ? renderProgress(progress) : `<p class="task-meta">未开启进度条</p>`}
          </div>
          <div class="button-row">
            ${target.hasProgress && !target.children?.length ? renderStepper(target.id, "", target.done || 0, target.total || 1) : ""}
          </div>
        </div>
        ${target.collapsed ? "" : renderSubtasks(target)}
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
          ${item.description ? `<p class="task-description">${escapeMultiline(item.description)}</p>` : ""}
        </div>
        <div class="task-count-controls">
          ${item.hasProgress ? renderStepper(targetId, item.id, item.done || 0, item.total || 1) : ""}
          ${
            ui.targetEditing
              ? `<button class="move-button" type="button" data-action="move-subtask" data-target-id="${targetId}" data-subtask-id="${item.id}" data-direction="-1" aria-label="上移">▴</button>
                <button class="move-button" type="button" data-action="move-subtask" data-target-id="${targetId}" data-subtask-id="${item.id}" data-direction="1" aria-label="下移">▾</button>`
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
    return `
      <div class="scope-navigator" data-scope-owner="${owner}">
        <button class="date-arrow" type="button" data-action="shift-scope-date" data-owner="${owner}" data-direction="-1" aria-label="上一个">‹</button>
        <span>${escapeHtml(scopeDisplay(scope))}</span>
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
                    <button class="move-button" type="button" data-action="move-habit" data-direction="-1" aria-label="上移">▴</button>
                    <button class="move-button" type="button" data-action="move-habit" data-direction="1" aria-label="下移">▾</button>
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
    const reviewItems = reviewsForCurrentScope();
    const totals = totalsForReviewScope();
    const habitRate = habitRateForScope();
    $("#app").innerHTML = `
      <section class="view" data-view="review">
        <div class="section-band">
          <div class="review-header">
            <div>
              <h2>复盘</h2>
              <p class="hint">按日、周、月记录事件、原因和下一步调整。</p>
            </div>
            <div class="button-row">
              <div class="review-tabs">
              ${["day", "week", "month"].map((scope) => `<button class="toggle-button ${state.reviewScope === scope ? "active" : ""}" type="button" data-action="set-review-scope" data-scope="${scope}">${reviewLabel(scope)}</button>`).join("")}
              </div>
            </div>
          </div>
          ${renderScopeNavigator(state.reviewScope, "review")}
        </div>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h2>长期规划</h2>
              <p class="hint">可以维护持续关注的能力和方向。</p>
            </div>
            <div class="button-row">
              <button class="secondary-button add-button" type="button" data-action="add-plan" aria-label="新增规划">+</button>
              <button class="primary-button" type="button" data-action="toggle-plan-edit">${ui.plansEditing ? "完成" : "编辑"}</button>
            </div>
          </div>
          <div class="plans-list">
            ${state.settings.plans.map((plan, index) => renderPlan(plan, index)).join("")}
          </div>
        </section>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h2>${reviewLabel(state.reviewScope)}汇总数据</h2>
              <p class="hint">时间分配和习惯达标率随所选范围变化。</p>
            </div>
          </div>
          <div class="data-summary">
            ${renderPie(totals)}
            <div class="stat-list">
              ${renderStatRows(totals)}
              <div class="stat-row">
                <span>习惯平均达标率</span>
                <strong>${habitRate}%</strong>
              </div>
            </div>
          </div>
        </section>

        <section class="section-band">
          <div class="section-title">
            <div>
              <h2>${reviewLabel(state.reviewScope)}框架</h2>
              <p class="hint">一件事，对应一个现象和一个原因。</p>
            </div>
            <div class="button-row">
              <button class="secondary-button add-button" type="button" data-action="add-review-item" aria-label="新增事情">+</button>
              <button class="primary-button" type="button" data-action="toggle-review-edit">${ui.reviewEditing ? "完成" : "编辑"}</button>
            </div>
          </div>
          <div class="review-stack">
            ${reviewItems.length ? reviewItems.map(renderReviewItem).join("") : `<p class="empty">还没有复盘事项。</p>`}
          </div>
        </section>
      </section>
    `;
  }

  function renderPlan(plan, index) {
    return `
      <span class="plan-pill" data-plan-index="${index}">
        ${escapeHtml(plan)}
        ${
          ui.plansEditing
            ? `
              <button class="move-button" type="button" data-action="move-plan" data-direction="-1" aria-label="上移">▴</button>
              <button class="move-button" type="button" data-action="move-plan" data-direction="1" aria-label="下移">▾</button>
              <button class="ghost-button" type="button" data-action="edit-plan" aria-label="编辑规划">编辑</button>
              <button class="icon-button danger-icon small-icon" type="button" data-action="delete-plan" aria-label="删除规划">×</button>
            `
            : ""
        }
      </span>
    `;
  }

  function renderReviewItem(item) {
    const isEditing = ui.editingReviews.has(item.id);
    const placeholders = reviewPlaceholders(state.reviewScope);
    if (!isEditing) {
      return `
        <article class="review-item compact-review-item" data-review-id="${item.id}">
          <div class="entry-display-line">
            <strong>事情</strong>
            ${
              ui.reviewEditing
                ? `<div class="row-actions">
                    <button class="move-button" type="button" data-action="move-review-item" data-direction="-1" aria-label="上移">▴</button>
                    <button class="move-button" type="button" data-action="move-review-item" data-direction="1" aria-label="下移">▾</button>
                    <button class="ghost-button compact-action" type="button" data-action="edit-review-item">编辑</button>
                  </div>`
                : ""
            }
          </div>
          <p class="review-text">${item.event ? escapeMultiline(item.event) : "还没有写内容"}</p>
          <div class="entry-display-line muted-line"><strong>原因</strong></div>
          <p class="review-text">${item.reason ? escapeMultiline(item.reason) : "还没有写原因"}</p>
        </article>
      `;
    }
    return `
      <article class="review-item editing-review-item" data-review-id="${item.id}">
        <textarea rows="${textareaRows(item.event)}" data-action="update-review-item" data-field="event" placeholder="${placeholders.event}">${escapeHtml(item.event || "")}</textarea>
        <textarea rows="${textareaRows(item.reason)}" data-action="update-review-item" data-field="reason" placeholder="${placeholders.reason}">${escapeHtml(item.reason || "")}</textarea>
        <div class="button-row">
          <button class="icon-button danger-icon" type="button" data-action="delete-review-item" aria-label="删除复盘">×</button>
          <button class="secondary-button" type="button" data-action="save-review-item">保存</button>
        </div>
      </article>
    `;
  }

  function renderStatRows(totals) {
    const entries = Object.entries(totals).filter(([, minutes]) => minutes > 0);
    if (!entries.length) return `<p class="empty">所选范围还没有时间记录。</p>`;
    return entries
      .map(([tagId, minutes]) => {
        const tag = getTag(tagId);
        return `
          <div class="stat-row">
            <span class="stat-label"><i class="color-dot" style="background:${tag?.color || colors[0]}"></i>${escapeHtml(tag?.name || "未分类")}</span>
            <strong>${formatDuration(minutes)}</strong>
          </div>
        `;
      })
      .join("");
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
      state = mergeDefaults(structuredClone(defaults), parsed);
      saveState();
      clearLogDrafts();
      closeModal();
      render();
    } catch (error) {
      alert("备份内容不是有效的 JSON。");
    }
  }

  function openLoginModal() {
    openModal(
      session ? "云端同步" : "登录",
      `
        <p class="hint">登录后会使用 Supabase 表 ${SUPABASE_TABLE} 保存和读取数据。本地数据仍会保留。</p>
        ${
          session
            ? `<p class="sync-status">当前已登录：${escapeHtml(session.user?.email || session.user?.id || "Supabase 用户")}</p>`
            : `<label class="form-row"><span class="field-label">邮箱</span><input id="login-email" type="email" autocomplete="email" /></label>
               <label class="form-row"><span class="field-label">密码</span><input id="login-password" type="password" autocomplete="current-password" /></label>`
        }
        <p id="login-message" class="hint"></p>
        <div class="button-row">
          ${session ? "" : `<button class="primary-button" type="button" data-modal-action="login">登录</button>`}
          <button class="secondary-button" type="button" data-modal-action="save-cloud">保存到云端</button>
          <button class="secondary-button" type="button" data-modal-action="load-cloud">从云端读取</button>
          ${session ? `<button class="secondary-button" type="button" data-modal-action="logout">退出登录</button>` : ""}
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
              message.textContent = "登录成功。";
              render();
              openLoginModal();
            }
            if (action === "save-cloud") {
              message.textContent = "正在保存到云端...";
              await saveRemoteNow();
              message.textContent = "已保存到云端。";
            }
            if (action === "load-cloud") {
              message.textContent = "正在读取云端数据...";
              await loadRemoteState();
              message.textContent = "已读取云端数据。";
              closeModal();
              render();
            }
            if (action === "logout") {
              session = null;
              localStorage.removeItem(SESSION_KEY);
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
    remoteSaveTimer = setTimeout(() => {
      saveRemoteNow().catch((error) => console.warn(error));
    }, 900);
  }

  async function saveRemoteNow() {
    if (!session?.access_token || !session.user?.id) throw new Error("请先登录。");
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`, {
      method: "POST",
      headers: supabaseHeaders(true, { Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({
        id: session.user.id,
        user_id: session.user.id,
        payload: state,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error(await readableRemoteError(response));
  }

  async function loadRemoteState() {
    if (!session?.access_token || !session.user?.id) throw new Error("请先登录。");
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(session.user.id)}&select=payload&limit=1`, {
      headers: supabaseHeaders(),
    });
    if (!response.ok) throw new Error(await readableRemoteError(response));
    const rows = await response.json();
    if (!rows.length || !rows[0].payload) throw new Error("云端还没有备份数据。");
    state = mergeDefaults(structuredClone(defaults), rows[0].payload);
    saveState();
    clearLogDrafts();
  }

  async function readableRemoteError(response) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      return data.message || data.msg || text || "云端操作失败。";
    } catch (error) {
      return text || "云端操作失败。";
    }
  }

  function openDatePicker() {
    const input = $("#global-date");
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

  function openTargetModal(existingTarget = null) {
    const isEdit = Boolean(existingTarget);
    const children = existingTarget?.children?.length ? existingTarget.children : [];
    openModal(
      isEdit ? "编辑目标" : "新增目标",
      `
        <label class="form-row">
          <span class="field-label">母任务</span>
          <input id="target-name" value="${escapeAttr(existingTarget?.name || "")}" placeholder="例如：完成文献阅读" />
        </label>
        <label class="form-row">
          <span class="field-label">母任务描述</span>
          <input id="target-description" value="${escapeAttr(existingTarget?.description || "")}" placeholder="可选，一句话描述" />
        </label>
        <div class="compact-form-row">
          <label class="check-inline">
            <input id="target-progress" class="checkbox" type="checkbox" ${existingTarget?.hasProgress !== false ? "checked" : ""} />
            进度条
          </label>
          <label class="form-row">
            <span class="field-label">母任务数量</span>
            <input id="target-total" type="number" min="1" step="1" value="${existingTarget?.total || 1}" />
          </label>
        </div>
        ${isEdit ? `<button class="icon-button danger-icon modal-delete" type="button" data-modal-action="delete-target-modal" aria-label="删除目标">×</button>` : ""}
        <div class="section-title">
          <div>
            <h2>子任务</h2>
            <p class="hint">二级、三级任务都可以分别填写数量和一句话描述，数量会计入进度条。</p>
          </div>
          <button class="secondary-button add-button" type="button" data-modal-action="add-child-row" aria-label="新增子任务">+</button>
        </div>
        <div id="child-editor" class="tag-editor">
          ${children.length ? children.map(renderChildEditor).join("") : renderChildEditor()}
        </div>
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
      <section class="tag-card" data-child-row data-child-id="${child?.id || ""}">
        <div class="grid-2">
          <label class="form-row"><span class="field-label">二级任务</span><input data-child-field="name" value="${escapeAttr(child?.name || "")}" placeholder="例如：读完第一篇" /></label>
          <label class="form-row"><span class="field-label">数量</span><input data-child-field="total" type="number" min="1" step="1" value="${child?.total || 1}" /></label>
        </div>
        <label class="form-row"><span class="field-label">二级任务描述</span><input data-child-field="description" value="${escapeAttr(child?.description || "")}" placeholder="可选，一句话描述" /></label>
        <div class="grandchild-editor-wrap">
          <div class="section-title mini-title">
            <div>
              <h2>三级任务</h2>
              <p class="hint">每条都可单独设置数量。</p>
            </div>
            <button class="secondary-button add-button" type="button" data-modal-action="add-grandchild-row" aria-label="新增三级任务">+</button>
          </div>
          <div class="grandchild-editor" data-grandchild-editor>
            ${(child?.children || []).map(renderGrandchildEditor).join("")}
          </div>
        </div>
        <button class="icon-button danger-icon" type="button" data-modal-action="delete-child-row" aria-label="删除子任务">×</button>
      </section>
    `;
  }

  function renderGrandchildEditor(grandchild = null) {
    return `
      <div class="grandchild-row" data-grandchild-row data-grandchild-id="${grandchild?.id || ""}">
        <input data-grandchild-field="name" value="${escapeAttr(grandchild?.name || "")}" placeholder="三级任务" aria-label="三级任务" />
        <input data-grandchild-field="total" type="number" min="1" step="1" value="${grandchild?.total || 1}" aria-label="三级任务数量" />
        <input data-grandchild-field="description" value="${escapeAttr(grandchild?.description || "")}" placeholder="一句话描述，可不填" aria-label="三级任务描述" />
        <button class="icon-button danger-icon" type="button" data-modal-action="delete-grandchild-row" aria-label="删除三级任务">×</button>
      </div>
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
          children: grandchildren,
        };
      })
      .filter(Boolean);

    const total = Math.max(1, Number($("#target-total", backdrop).value) || 1);
    return {
      id: existingTarget?.id || uid(),
      name: $("#target-name", backdrop).value.trim() || "未命名目标",
      description: $("#target-description", backdrop).value.trim(),
      hasProgress: $("#target-progress", backdrop).checked,
      total,
      done: Math.min(existingTarget?.done || 0, total),
      collapsed: existingTarget?.collapsed || false,
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
            <input id="habit-color" type="color" value="${currentColor}" />
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
    if (action === "open-login") return openLoginModal();
    if (action === "shift-scope-date") return shiftScopeDate(actionNode.dataset.owner, Number(actionNode.dataset.direction) || 0);
    if (action === "toggle-record-edit") return toggleEditMode("recordEditing");
    if (action === "toggle-target-edit") return toggleEditMode("targetEditing");
    if (action === "toggle-habit-edit") return toggleEditMode("habitEditing");
    if (action === "toggle-review-edit") return toggleEditMode("reviewEditing");
    if (action === "edit-segments") return openSegmentsModal();
    if (action === "edit-tags") return openTagsModal();
    if (action === "add-log") return addLog(actionNode.dataset.segmentId);
    if (action === "edit-log") return editLog(actionNode.closest("[data-log-id]").dataset.logId);
    if (action === "save-log") return saveLog(actionNode.closest("[data-log-id]"));
    if (action === "delete-log") return requestDeleteLog(actionNode.closest("[data-log-id]"));
    if (action === "move-log") return moveLog(actionNode.closest("[data-log-id]").dataset.logId, Number(actionNode.dataset.direction));
    if (action === "set-target-scope") return setState((draft) => (draft.targetScope = actionNode.dataset.scope));
    if (action === "add-target") return openTargetModal();
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
    if (action === "add-plan") return openPlanModal();
    if (action === "toggle-plan-edit") return togglePlanEdit();
    if (action === "edit-plan") return openPlanModal(Number(actionNode.closest("[data-plan-index]").dataset.planIndex));
    if (action === "delete-plan") return confirmDelete("确认要删除这个长期规划吗？", () => deletePlan(Number(actionNode.closest("[data-plan-index]").dataset.planIndex)));
    if (action === "move-plan") return movePlan(Number(actionNode.closest("[data-plan-index]").dataset.planIndex), Number(actionNode.dataset.direction));
    if (action === "add-review-item") return addReviewItem();
    if (action === "edit-review-item") return editReviewItem(actionNode.closest("[data-review-id]").dataset.reviewId);
    if (action === "save-review-item") return saveReviewItem(actionNode.closest("[data-review-id]"));
    if (action === "delete-review-item") return confirmDelete("确认要删除这条复盘吗？", () => deleteReviewItem(actionNode.closest("[data-review-id]").dataset.reviewId));
    if (action === "move-review-item") return moveReviewItem(actionNode.closest("[data-review-id]").dataset.reviewId, Number(actionNode.dataset.direction));
  });

  document.addEventListener("input", (event) => {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    if (action === "update-log") updateLog(actionNode.closest("[data-log-id]").dataset.logId, actionNode.dataset.field, actionNode.value, false);
    if (action === "update-habit") updateHabit(actionNode.closest("[data-habit-id]").dataset.habitId, actionNode.value, actionNode, false);
    if (action === "update-review-item") updateReviewItem(actionNode.closest("[data-review-id]").dataset.reviewId, actionNode.dataset.field, actionNode.value);
    if (action === "set-review-date") setReviewDate(actionNode.value);
  });

  document.addEventListener("change", (event) => {
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    if (actionNode.dataset.action === "update-log") {
      updateLog(actionNode.closest("[data-log-id]").dataset.logId, actionNode.dataset.field, actionNode.value, actionNode.dataset.field !== "note");
    }
    if (actionNode.dataset.action === "update-habit") {
      updateHabit(actionNode.closest("[data-habit-id]").dataset.habitId, actionNode.value, actionNode, true);
    }
    if (actionNode.dataset.action === "toggle-subtask-done") {
      const row = actionNode.closest("[data-subtask-id]");
      setSubtaskDone(row.dataset.targetId, row.dataset.subtaskId, actionNode.checked);
    }
  });

  $("#global-date").addEventListener("change", (event) => {
    setState((draft) => {
      clearLogDrafts();
      draft.date = event.target.value || todayIso();
    });
  });

  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      setState((draft) => {
        if (draft.activeTab !== button.dataset.tab) clearLogDrafts();
        draft.activeTab = button.dataset.tab;
      });
    });
  });

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
      clearLogDrafts();
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
      clearLogDrafts();
      draft.date = isoFromDate(current);
    });
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

  function toggleEditMode(key) {
    ui[key] = !ui[key];
    if (key === "recordEditing" && !ui[key]) clearLogDrafts();
    if (key === "reviewEditing" && !ui[key]) ui.editingReviews.clear();
    render();
  }

  function toggleTarget(targetId) {
    setState(() => {
      const target = getTarget(targetId);
      target.collapsed = !target.collapsed;
    });
  }

  function deleteTarget(targetId) {
    setState((draft) => {
      const list = targetsForScopeDraft(draft, state.targetScope, scopeKey(state.targetScope));
      const index = list.findIndex((item) => item.id === targetId);
      if (index >= 0) list.splice(index, 1);
    });
  }

  function stepProgress(targetId, subtaskId, delta) {
    setState(() => {
      const target = getTarget(targetId);
      const item = subtaskId ? findChild(target, subtaskId) : target;
      if (!item) return;
      item.done = clamp((item.done || 0) + delta, 0, item.total || 1);
    });
  }

  function setSubtaskDone(targetId, subtaskId, checked) {
    setState(() => {
      const target = getTarget(targetId);
      const item = findChild(target, subtaskId);
      if (!item) return;
      item.done = checked ? item.total || 1 : 0;
      (item.children || []).forEach((child) => {
        child.done = checked ? child.total || 1 : 0;
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

  function addReviewItem() {
    const id = uid();
    ui.editingReviews.add(id);
    setState((draft) => {
      const list = reviewsForScopeDraft(draft, state.reviewScope, scopeKey(state.reviewScope));
      list.push({ id, event: "", reason: "" });
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

  function updateReviewItem(itemId, field, value) {
    const item = reviewsForCurrentScope().find((review) => review.id === itemId);
    if (!item) return;
    item[field] = value;
    saveState();
  }

  function deleteReviewItem(itemId) {
    setState((draft) => {
      const list = reviewsForScopeDraft(draft, state.reviewScope, scopeKey(state.reviewScope));
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

  function moveReviewItem(itemId, direction) {
    setState((draft) => {
      moveInListById(reviewsForScopeDraft(draft, state.reviewScope, scopeKey(state.reviewScope)), itemId, direction);
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

  function habitRateForScope() {
    if (!state.habits.length) return 0;
    const dates = datesInScope(state.reviewScope, dateKey());
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

  function datesInScope(scope, date) {
    const start = new Date(`${scopeKey(scope, date)}T00:00:00`);
    const count = scope === "day" ? 1 : scope === "week" ? 7 : new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const d = new Date(start);
      d.setDate(start.getDate() + index);
      return isoFromDate(d);
    });
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
      if (item.hasProgress !== false) items.push(item);
      if (item.children?.length) item.children.forEach(visit);
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

  function reviewLabel(scope) {
    return { day: "日复盘", week: "周复盘", month: "月复盘" }[scope];
  }

  function scopeDisplay(scope) {
    const key = scopeKey(scope);
    if (scope === "day") return key;
    if (scope === "week") {
      const end = new Date(`${key}T00:00:00`);
      end.setDate(end.getDate() + 6);
      return `${key} 至 ${isoFromDate(end)}`;
    }
    return `${key.slice(0, 7)}`;
  }

  function weekdayText(date) {
    const day = new Date(`${date}T00:00:00`).getDay();
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day];
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
      event: `可以先写${unit}遇到的问题，也可以写${unit}做得很好的事情`,
      reason: `遇到的问题是什么原因？做得好的事情是为什么可以做得好`,
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
})();
