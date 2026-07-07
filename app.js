(function () {
  const STORAGE_KEY = "today-flow-state-v1";
  const SESSION_KEY = "today-flow-supabase-session-v1";
  const SUPABASE_URL = "https://hgmpswhitmenyvnxotff.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WW3rmZCePegJsIf6LeqFvQ_KRgHD9pz";
  const SUPABASE_TABLE = "phd_trac_records";
  const SLEEP_SOURCE_TABLE = "daily_record_sync";
  const SLEEP_STAT_KEY = "__sleep";
  const APP_VERSION = "v1.7";
  const VERSION_UPDATED_AT = "2026-07-07";
  const colors = ["#2f6f73", "#b35d4a", "#8a7b35", "#5d6f9f", "#7d5f89", "#4d7d4d", "#a55567", "#69724d"];
  const defaultLocationTypes = [
    { id: "outdoor", name: "户外", color: "#d8b74e" },
    { id: "work", name: "工位", color: "#4e7fa8" },
    { id: "dorm", name: "宿舍", color: "#4d8b57" },
  ];
  const DEFAULT_LOCATION_ID = "outdoor";

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
      locationTypes: defaultLocationTypes,
      defaultLocationId: DEFAULT_LOCATION_ID,
      expectedStudyHours: "",
      expectedWorkHours: "",
      expectedStudyVisible: true,
      expectedWorkVisible: true,
    },
    logs: {},
    locationLogs: {},
    locationDescriptions: {},
    holidays: [],
    targets: {},
    targetMigrations: {},
    habits: [],
    reviews: {},
    weeklyReviews: {},
    monthlyReviews: {},
  };

  let state = normalizeStateShape(loadState());
  let session = loadSession();
  let externalSleepData = null;
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
    editingLocationDescriptions: new Set(),
    locationDescriptionDrafts: new Map(),
    holidayEditing: false,
    editingReviews: new Set(),
    recordEditing: false,
    targetEditing: false,
    habitEditing: false,
    reviewEditing: false,
    plansEditing: false,
    targetFilterTag: "__all",
    collapsedTargetTags: new Set(),
    recordChartSeries: {
      work: true,
      study: true,
      efficiency: true,
    },
    recordChartWindowOffset: 0,
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
    normalized.locationDescriptions ||= {};
    normalized.holidays = normalizeHolidayRanges(normalized.holidays);
    normalized.targetMigrations ||= {};
    normalized.weeklyReviews ||= {};
    normalized.monthlyReviews ||= {};
    normalized.settings.targetTags = targetTagListFromState(normalized);
    normalized.settings.targetDefaultTag = normalizedTargetDefaultTag(normalized.settings.targetDefaultTag, normalized.settings.targetTags);
    normalized.settings.locationTypes = normalizeLocationTypes(normalized.settings.locationTypes);
    normalized.settings.defaultLocationId = normalizeLocationId(normalized.settings.defaultLocationId, normalized.settings.locationTypes);
    normalized.settings.expectedStudyHours = normalizedExpectedHours(normalized.settings.expectedStudyHours);
    normalized.settings.expectedWorkHours = normalizedExpectedHours(normalized.settings.expectedWorkHours);
    normalized.settings.expectedStudyVisible = normalized.settings.expectedStudyVisible !== false;
    normalized.settings.expectedWorkVisible = normalized.settings.expectedWorkVisible !== false;
    const legacyLocations = normalizeLocations(normalized.settings?.locations || {});
    const hasLocationLogs = Object.values(normalized.locationLogs).some((records) => {
      const daily = normalizeLocationRecords(records);
      return daily.records.length;
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
        locationTypes: mergeLocationTypes(remote.settings.locationTypes || [], local.settings.locationTypes || []),
        defaultLocationId: local.settings.defaultLocationId || remote.settings.defaultLocationId || DEFAULT_LOCATION_ID,
        locations: { work: [], dorm: [] },
      },
      logs: mergeDateCollections(remote.logs || {}, local.logs || {}),
      locationLogs: mergeLocationLogs(remote.locationLogs || {}, local.locationLogs || {}),
      locationDescriptions: mergeNestedTextMaps(remote.locationDescriptions || {}, local.locationDescriptions || {}),
      holidays: mergeById(remote.holidays || [], local.holidays || []),
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

  function mergeLocationTypes(remoteItems, localItems) {
    const map = new Map();
    normalizeLocationTypes(remoteItems).forEach((item) => map.set(item.id, item));
    normalizeLocationTypes(localItems).forEach((item) => map.set(item.id, item));
    return Array.from(map.values());
  }

  function mergeDateCollections(remoteCollections, localCollections) {
    const result = { ...remoteCollections };
    for (const [date, items] of Object.entries(localCollections)) {
      result[date] = mergeById(result[date] || [], items || []);
    }
    return result;
  }

  function mergeNestedTextMaps(remoteCollections, localCollections) {
    const result = { ...remoteCollections };
    for (const [date, items] of Object.entries(localCollections || {})) {
      result[date] = { ...(result[date] || {}), ...(items || {}) };
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
    return mergeLocationRecords(remoteLocations, localLocations);
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
      records: mergeById(remote.records, local.records),
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

  function isSunday(date) {
    const d = new Date(`${date}T00:00:00`);
    return !Number.isNaN(d.getTime()) && d.getDay() === 0;
  }

  function isLastDayOfMonth(date) {
    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    const nextDay = new Date(d);
    nextDay.setDate(d.getDate() + 1);
    return nextDay.getMonth() !== d.getMonth();
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

  function targetsForDate(date = dateKey()) {
    state.targets.day ||= {};
    const key = scopeKey("day", date);
    state.targets.day[key] ||= [];
    return state.targets.day[key];
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
    prepareTextareas($("#app"));
    bindRecordChartDrag($("#app"));
    triggerChartWaterMotion();
  }

  function renderRecord() {
    const logs = logsForDate();
    locationRecordsForDate();
    const blocks = recordTimelineBlocks(logs);
    $("#app").innerHTML = `
      <section class="view" data-view="record">
        <div class="section-band">
          <div class="section-title">
            <div>
              <div class="title-with-date">
                <h2>今日时间追踪</h2>
                <span>${dateKey()} ${weekdayText(dateKey())}</span>
              </div>
              <p class="hint">先在左侧时间轴添加地点时间，再在右侧地点块记录事项、时长和关联目标。</p>
            </div>
            <div class="button-row">
              ${ui.recordEditing ? `<button class="secondary-button" type="button" data-action="edit-locations">地点</button><button class="secondary-button" type="button" data-action="edit-tags">标签</button>` : ""}
              <button class="primary-button" type="button" data-action="toggle-record-edit">${ui.recordEditing ? "完成" : "编辑"}</button>
            </div>
          </div>
        </div>
        <div class="record-layout">
          ${renderRecordTimeline(logs, { includeDrafts: true })}
        </div>
        <section class="section-band record-efficiency-band">
          ${renderWorkEfficiencyStrip("day", dateKey())}
        </section>
        <section class="section-band today-summary">
          <div class="section-title compact-title">
            <div>
              <div class="summary-heading-line">
                <h2>学习时间统计</h2>
              </div>
              <p class="hint">${recordChartRangeText()}</p>
            </div>
            ${renderRecordChartControls()}
          </div>
          ${renderRecordSummaries()}
        </section>
        ${renderRecordBottomSettings()}
      </section>
    `;
  }

  function renderDayAxis() {
    const range = recordAxisRange();
    const slices = locationSlicesForRange(range.start, range.end);
    const total = range.end - range.start;
    return `
      <aside class="record-axis" aria-label="地点时间轴">
        <div class="axis-bar">
          ${slices
            .map((slice, index) => renderAxisSlice(slice, index, slices.length, range.start, total))
            .join("")}
          ${slices
            .slice(0, -1)
            .map((slice) => renderAxisBoundaryLabel(slice.end, range.start, total))
            .join("")}
        </div>
        ${slices.some((slice) => slice.auto) ? `<button class="axis-add-time" type="button" data-action="add-location-time">添加时间</button>` : ""}
      </aside>
    `;
  }

  function renderRecordTimeline(logs, options = {}) {
    const range = recordAxisRange();
    const total = range.end - range.start;
    const slices = locationSlicesForRange(range.start, range.end);
    const blocks = recordTimelineBlocks(logs, options);
    const draftLogs = options.includeDrafts !== false ? [...ui.logDrafts.values()].filter((entry) => entry.date === dateKey()) : [];
    const visibleBlocks = options.requireLogs
      ? blocks.filter((block) => block.logs.length || block.drafts.length || locationDescriptionForIds(block.ids || [block.id]))
      : blocks;
    const blockByAxisKey = new Map(
      visibleBlocks
        .filter((block) => !block.legacy)
        .map((block) => [locationAxisKey(block.ids || [block.id]), block]),
    );
    const legacyBlocks = visibleBlocks.filter((block) => block.legacy);
    const rows = slices
      .map((slice, index) => {
        const key = locationAxisKey(slice.ids || []);
        let block = blockByAxisKey.get(key) || null;
        if (!block && slice.type) {
          block = timelineBlockFromSlice(slice, logs, draftLogs);
          if (options.requireLogs && !block.logs.length && !block.drafts.length && !locationDescriptionForIds(block.ids || [block.id])) block = null;
        }
        return renderTimelineRow(slice, index, slices.length, range.start, total, block);
      })
      .join("");
    return `
      <div class="record-with-axis">
        ${rows}
        ${legacyBlocks.map((block) => renderLegacyTimelineRow(block)).join("")}
        ${slices.some((slice) => slice.auto) ? `<button class="axis-add-time" type="button" data-action="add-location-time">添加时间</button>` : ""}
      </div>
    `;
  }

  function renderTimelineRow(slice, index, count, rangeStart, total, block = null) {
    const minutes = slice.end - slice.start;
    const rowMin = Math.max(34, Math.round((minutes / total) * 220));
    const topGap = index > 0 ? "var(--axis-label-gap)" : "0px";
    const bottomGap = index < count - 1 ? "var(--axis-label-gap)" : "0px";
    return `
      <div class="timeline-row" style="--row-min:${rowMin}px;--row-top-gap:${topGap};--row-bottom-gap:${bottomGap}">
        <div class="axis-row-cell">
          ${index === 0 ? renderAxisStartLabel(slice.start) : ""}
          ${renderAxisSlice(slice, index, count)}
          ${index < count - 1 ? renderAxisBoundaryLabel(slice.end) : ""}
        </div>
        <div class="timeline-row-content">
          ${block ? renderLocationBlock(block) : ""}
        </div>
      </div>
    `;
  }

  function renderLegacyTimelineRow(block) {
    return `
      <div class="timeline-row legacy-timeline-row" style="--row-min:auto">
        <div class="axis-row-cell"></div>
        <div class="timeline-row-content">
          ${renderLocationBlock(block)}
        </div>
      </div>
    `;
  }

  function locationAxisKey(ids = []) {
    return [...ids].filter(Boolean).sort().join("|");
  }

  function autoOutdoorId(date, start, end) {
    return `auto-outdoor-${date}-${Math.round(start)}-${Math.round(end)}`;
  }

  function renderAxisSlice(slice, index, count) {
    const beforeGap = index > 0 ? "var(--axis-label-gap)" : "0px";
    const afterGap = index < count - 1 ? "var(--axis-label-gap)" : "0px";
    return `
      <button
        class="axis-slice axis-${slice.type || "empty"}"
        type="button"
        data-action="set-location-slice"
        data-location-id="${escapeAttr(slice.id || "")}"
        data-location-ids="${escapeAttr((slice.ids || []).join(","))}"
        data-location-type="${escapeAttr(slice.type || defaultLocationId())}"
        data-axis-start="${escapeAttr(minutesToTime(slice.start))}"
        data-axis-end="${escapeAttr(minutesToTime(slice.end))}"
        style="top:${beforeGap};bottom:${afterGap};--location-color:${locationColor(slice.type)};--location-soft:${locationSoftColor(slice.type, 0.18)}"
        title="${locationLabel(slice.type)} ${minutesToTime(slice.start)}-${minutesToTime(slice.end)}"
        aria-label="${locationLabel(slice.type)} ${minutesToTime(slice.start)} 到 ${minutesToTime(slice.end)}"
      ></button>
    `;
  }

  function renderAxisBoundaryLabel(minute) {
    return `
      <span class="axis-boundary-label">${escapeHtml(minutesToTime(minute))}</span>
    `;
  }

  function renderAxisStartLabel(minute) {
    return `
      <span class="axis-boundary-label axis-start-label">${escapeHtml(minutesToTime(minute))}</span>
    `;
  }

  function recordTimelineBlocks(logs, options = {}) {
    const includeDrafts = options.includeDrafts !== false;
    const entries = mergedLocationEntriesForDate(dateKey()).filter((entry) => entry.type && entry.start && entry.end);
    const draftLogs = includeDrafts ? [...ui.logDrafts.values()].filter((entry) => entry.date === dateKey()) : [];
    const knownIds = new Set(entries.flatMap((entry) => entry.ids || [entry.id]));
    const range = recordAxisRange();
    const autoOutdoorIds = new Set(
      locationSlicesForRange(range.start, range.end)
        .flatMap((slice) => slice.ids || [slice.id])
        .filter((id) => String(id || "").startsWith("auto-outdoor-")),
    );
    const blocks = entries.map((entry) => {
      const ids = entry.ids || [entry.id];
      const persistedLogs = logs.filter((log) => ids.includes(log.segmentId));
      return {
        id: entry.id,
        ids,
        type: entry.type,
        title: locationLabel(entry.type),
        start: entry.start,
        end: entry.end,
        rawEnd: entry.rawEnd ?? entry.end,
        openEnd: Boolean(entry.openEnd),
        source: entry.source,
        logs: persistedLogs,
        drafts: draftLogsForSegment(draftLogs, ids, persistedLogs),
      };
    });

    const legacyBlocks = state.settings.segments
      .map((segment) => {
        const ids = [segment.id];
        const persistedLogs = logs.filter((log) => ids.includes(log.segmentId));
        return {
          id: segment.id,
          type: "",
          title: `未分配地点 · ${segment.name}`,
          start: segment.start,
          end: segment.end,
          legacy: true,
          logs: persistedLogs,
          drafts: draftLogsForSegment(draftLogs, ids, persistedLogs),
        };
      })
      .filter((block) => block.logs.length || block.drafts.length);

    const legacyIds = new Set(state.settings.segments.map((segment) => segment.id));
    const orphanIds = Array.from(
      new Set([...logs, ...draftLogs].map((log) => log.segmentId).filter((id) => id && !knownIds.has(id) && !legacyIds.has(id) && !autoOutdoorIds.has(id))),
    );
    const orphanBlocks = orphanIds.map((id) => {
      const ids = [id];
      const persistedLogs = logs.filter((log) => ids.includes(log.segmentId));
      return {
        id,
        type: "",
        title: "未分配地点",
        start: "",
        end: "",
        legacy: true,
        logs: persistedLogs,
        drafts: draftLogsForSegment(draftLogs, ids, persistedLogs),
      };
    });

    return [...blocks, ...legacyBlocks, ...orphanBlocks].filter((block) => block.logs.length || block.drafts.length || !block.legacy);
  }

  function timelineBlockFromSlice(slice, logs, draftLogs) {
    const id = slice.id || autoOutdoorId(dateKey(), slice.start, slice.end);
    const ids = slice.ids?.length ? slice.ids : [id];
    const persistedLogs = logs.filter((log) => ids.includes(log.segmentId));
    return {
      id,
      ids,
      type: slice.type || DEFAULT_LOCATION_ID,
      title: locationLabel(slice.type || DEFAULT_LOCATION_ID),
      start: minutesToTime(slice.start),
      end: minutesToTime(slice.end),
      rawEnd: minutesToTime(slice.end),
      auto: Boolean(slice.auto),
      logs: persistedLogs,
      drafts: draftLogsForSegment(draftLogs, ids, persistedLogs),
    };
  }

  function draftLogsForSegment(draftLogs, ids, persistedLogs = []) {
    const persistedIds = new Set(persistedLogs.map((log) => log.id));
    return draftLogs.filter((log) => ids.includes(log.segmentId) && !persistedIds.has(log.id));
  }

  function renderLocationBlock(block) {
    const ids = (block.ids?.length ? block.ids : [block.id]).filter(Boolean);
    const color = locationColor(block.type);
    const tone = locationBlockTone(block.type);
    const legacyClass = block.legacy ? " legacy-location-block" : "";
    const outdoorClass = block.type === DEFAULT_LOCATION_ID ? " outdoor-location-block" : "";
    const hasAutoId = ids.some((id) => String(id).startsWith("auto-outdoor-"));
    const autoClass = block.auto || hasAutoId ? " auto-location-block" : "";
    const hasEntries = block.logs.length || block.drafts.length;
    const noteKey = locationAxisKey(ids);
    const savedDescription = locationDescriptionForIds(ids);
    const draftDescription = ui.locationDescriptionDrafts.has(noteKey) ? ui.locationDescriptionDrafts.get(noteKey) : savedDescription;
    const descriptionOpen = ui.editingLocationDescriptions.has(noteKey);
    const timeText = locationBlockTimeText(block);
    return `
      <section
        class="segment-panel location-record-block${legacyClass}${outdoorClass}${autoClass}"
        data-location-block="${escapeAttr(block.id)}"
        data-location-ids="${escapeAttr(ids.join(","))}"
        data-location-note-key="${escapeAttr(noteKey)}"
        data-location-type="${escapeAttr(block.type || "")}"
        data-location-start="${escapeAttr(block.start || "")}"
        data-location-end="${escapeAttr(block.end || "")}"
        data-location-raw-end="${escapeAttr(block.rawEnd ?? block.end ?? "")}"
        style="--location-color:${color};--location-bg:${tone.bg};--location-border:${tone.border}"
      >
        <div class="segment-header">
          <div class="segment-title-line">
            <h2>${escapeHtml(block.title)}</h2>
            ${timeText ? `<span class="segment-time">${timeText}</span>` : ""}
          </div>
          <div class="button-row compact-row-actions">
            ${block.legacy && hasEntries ? renderLocationAssignmentSelect(ids) : ""}
            ${ui.recordEditing && !block.legacy && !block.auto && !hasAutoId ? `<button class="ghost-button compact-action" type="button" data-action="edit-location-time">编辑</button>` : ""}
            <button class="icon-button description-toggle location-description-toggle ${descriptionOpen ? "active" : ""}" type="button" data-action="toggle-location-description" aria-label="地点描述">☰</button>
            <button class="icon-button" type="button" data-action="add-log" data-segment-id="${escapeAttr(block.id)}" aria-label="新增记录">+</button>
          </div>
        </div>
        ${renderLocationDescription(ids, noteKey, savedDescription, draftDescription, descriptionOpen, color)}
        ${
          hasEntries
            ? `<div class="entries">${[...block.logs.map((entry) => renderLogEntry(entry, false)), ...block.drafts.map((entry) => renderLogEntry(entry, true))].join("")}</div>`
            : ""
        }
      </section>
    `;
  }

  function renderLocationAssignmentSelect(sourceIds = []) {
    const options = locationAssignmentOptions();
    if (!options.length) return "";
    return `
      <select class="location-assign-select" data-action="assign-location-block" data-source-location-ids="${escapeAttr(sourceIds.join(","))}" aria-label="分配地点">
        <option value="">分配地点</option>
        ${options.map((option) => `<option value="${escapeAttr(option.id)}">${escapeHtml(option.label)}</option>`).join("")}
      </select>
    `;
  }

  function locationBlockTone(type) {
    if (type === DEFAULT_LOCATION_ID) {
      return {
        bg: "rgba(251, 252, 250, 0.82)",
        border: "rgba(32, 35, 31, 0.08)",
      };
    }
    return {
      bg: locationSoftColor(type, 0.13),
      border: locationSoftColor(type, 0.3),
    };
  }

  function locationBlockTimeText(block) {
    if (block.type === DEFAULT_LOCATION_ID) return "";
    if (!block.start) return "旧记录";
    if (block.openEnd) return `${escapeHtml(block.start)} -`;
    return block.end ? `${escapeHtml(block.start)} - ${escapeHtml(block.end)}` : `${escapeHtml(block.start)} -`;
  }

  function renderLocationDescription(ids, noteKey, savedDescription, draftDescription, isEditing, color) {
    if (isEditing) {
      return `
        <div class="location-description-editor bullet-textarea-wrap" style="--bullet-color:${color}">
          <div class="bullet-line-layer" aria-hidden="true">${renderBulletMarkers(draftDescription)}</div>
          <textarea
            class="bullet-textarea location-description-input"
            rows="${locationDescriptionRows(draftDescription)}"
            data-action="update-location-description"
            data-location-note-key="${escapeAttr(noteKey)}"
            data-location-note-ids="${escapeAttr(ids.join(","))}"
            placeholder=""
          >${escapeHtml(draftDescription || "")}</textarea>
        </div>
      `;
    }
    const lines = locationDescriptionLines(savedDescription);
    if (!lines.length) return "";
    return `
      <div class="location-description-list">
        ${lines
          .map(
            (line) => `
              <p class="location-description-line">
                <i style="background:${color}"></i>
                <span>${escapeHtml(line)}</span>
              </p>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function locationDescriptionForIds(ids = [], date = dateKey()) {
    const descriptions = state.locationDescriptions?.[date] || {};
    return ids.map((id) => descriptions[id]).filter(Boolean).join("\n");
  }

  function locationDescriptionLines(value) {
    return normalizeLocationDescription(value)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function normalizeLocationDescription(value) {
    return normalizeBulletTextareaValue(value, { removeEmptyLines: true }).trim();
  }

  function locationDescriptionRows(value) {
    const lines = String(value || "").split("\n").length;
    return clamp(lines || 1, 1, 6);
  }

  function renderRecordBottomSettings() {
    const holidays = normalizeHolidayRanges(state.holidays);
    const visibleHolidays = holidays.filter((holiday) => holiday.end >= dateKey());
    return `
      <section class="section-band record-bottom-settings">
        <div class="expected-hours-panel">
          <div>
            <h2>期望时长</h2>
          </div>
          <label class="expected-hour-row">
            <span class="expected-hour-label">期望学习<input class="checkbox" type="checkbox" data-action="toggle-expected-line" data-field="study" ${state.settings.expectedStudyVisible !== false ? "checked" : ""} /></span>
            <input data-action="update-expected-hours" data-field="study" type="number" min="0" step="0.5" value="${escapeAttr(state.settings.expectedStudyHours || "")}" placeholder="小时" />
          </label>
          <label class="expected-hour-row">
            <span class="expected-hour-label">期望工位<input class="checkbox" type="checkbox" data-action="toggle-expected-line" data-field="work" ${state.settings.expectedWorkVisible !== false ? "checked" : ""} /></span>
            <input data-action="update-expected-hours" data-field="work" type="number" min="0" step="0.5" value="${escapeAttr(state.settings.expectedWorkHours || "")}" placeholder="小时" />
          </label>
        </div>
        <section class="holiday-settings-panel">
          <div class="section-title compact-title holiday-settings-title">
            <div>
              <h2>假期</h2>
            </div>
            <div class="button-row compact-row-actions">
              <button class="secondary-button" type="button" data-action="edit-holidays">${ui.holidayEditing ? "收起" : "编辑"}</button>
              <button class="secondary-button add-button" type="button" data-action="add-holiday" aria-label="新增假期">+</button>
            </div>
          </div>
          <div class="holiday-range-list ${ui.holidayEditing ? "editing" : "display"}">
            ${
              ui.holidayEditing
                ? `${visibleHolidays.map(renderHolidayRangeRow).join("") || `<p class="empty compact-empty">暂无假期。</p>`}<button class="primary-button holiday-save-button" type="button" data-action="save-holidays">保存</button>`
                : visibleHolidays.length
                  ? visibleHolidays.map(renderHolidayRangeDisplay).join("")
                  : ""
            }
          </div>
        </section>
      </section>
    `;
  }

  function renderHolidayRangeDisplay(holiday) {
    return `
      <div class="holiday-range-display" data-holiday-id="${escapeAttr(holiday.id)}">
        <span>假期</span>
        <strong>${escapeHtml(formatHolidayRange(holiday))}</strong>
      </div>
    `;
  }

  function renderHolidayRangeRow(holiday) {
    return `
      <div class="holiday-range-row" data-holiday-id="${escapeAttr(holiday.id)}">
        <label class="form-row">
          <span class="field-label">开始</span>
          <input data-action="update-holiday" data-field="start" type="date" value="${escapeAttr(holiday.start)}" />
        </label>
        <label class="form-row">
          <span class="field-label">结束</span>
          <input data-action="update-holiday" data-field="end" type="date" value="${escapeAttr(holiday.end)}" />
        </label>
        <button class="danger-button" type="button" data-action="delete-holiday">删除</button>
      </div>
    `;
  }

  function renderSegment(segment, logs) {
    const segmentLogs = logs.filter((entry) => entry.segmentId === segment.id);
    const draftLogs = draftLogsForSegment(
      [...ui.logDrafts.values()].filter((entry) => entry.date === dateKey()),
      [segment.id],
      segmentLogs,
    );
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

  function renderLocationPanel(locations, options = {}) {
    const includeDrafts = options.includeDrafts !== false;
    const entries = locationEntriesForDate(dateKey(), locations);
    const drafts = includeDrafts ? [...ui.locationDrafts.values()].filter((entry) => entry.date === dateKey()) : [];
    return `
      <section class="segment-panel location-panel">
        <div class="segment-header">
          <div class="segment-title-line">
            <h2>地点时间</h2>
            <span class="segment-time">${locationTypes().map((item) => escapeHtml(item.name)).join(" / ")}</span>
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
    const isSynced = visibleEntry.synced || visibleEntry.source === "sleep";
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
            ${renderLocationTypeOptions(visibleEntry.type)}
          </select>
          <div class="grid-2 tight-grid">
            <input data-action="update-location" data-field="start" type="time" value="${visibleEntry.start || ""}" aria-label="开始时间" />
            <input data-action="update-location" data-field="end" type="time" value="${visibleEntry.end || ""}" aria-label="结束时间" />
          </div>
        </div>
        <div class="log-edit-buttons">
          <button class="secondary-button" type="button" data-action="save-location">保存</button>
          ${(ui.recordEditing || isDraft) && !isSynced ? `<button class="danger-button" type="button" data-action="delete-location">删除</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderLogEntry(entry, isDraft = false) {
    const draft = ui.logDrafts.get(entry.id);
    const visibleEntry = draft || entry;
    const isEditing = isDraft || ui.editingLogs.has(entry.id);
    const logDate = visibleEntry.date || dateKey();
    const linkedTargetName = targetNameForLogLink(visibleEntry.targetId, logDate);
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
          ${linkedTargetName ? `<p class="entry-linked-target">目标：${escapeHtml(linkedTargetName)}</p>` : ""}
        </article>
      `;
    }
    return `
      <article class="entry editing-entry" data-log-id="${entry.id}" data-draft="${isDraft ? "true" : "false"}">
        <div class="entry-edit-grid">
          <select data-action="update-log" data-field="tagId" aria-label="一级标签">${tagOptions}</select>
          <select data-action="update-log" data-field="subtag" aria-label="二级标签">${subtagOptions}</select>
        </div>
        <div class="entry-edit-grid">
          <input data-action="update-log" data-field="minutes" type="number" min="0" step="5" value="${visibleEntry.minutes || 0}" aria-label="分钟数" />
          <select data-action="update-log" data-field="targetId" aria-label="对应目标">
            ${renderLogTargetOptions(visibleEntry.targetId, logDate)}
          </select>
        </div>
        <textarea rows="${textareaRows(visibleEntry.note)}" data-action="update-log" data-field="note" placeholder="可填写任务内容及描述状态">${escapeHtml(visibleEntry.note || "")}</textarea>
        <div class="log-edit-buttons">
          <button class="secondary-button" type="button" data-action="save-log">保存</button>
          <button class="danger-button" type="button" data-action="delete-log">删除</button>
        </div>
      </article>
    `;
  }

  function renderLogTargetOptions(selectedTargetId = "", date = dateKey()) {
    const selected = String(selectedTargetId || "");
    const seen = new Set();
    let selectedKnown = !selected;
    const options = targetsForDate(date)
      .map((target) => {
        const value = targetLinkId(target);
        if (!value || seen.has(value)) return "";
        seen.add(value);
        const isSelected = selected === value || targetLinkedIds(target).has(selected);
        if (isSelected) selectedKnown = true;
        const tag = targetTag(target);
        const label = tag && tag !== "未分类" ? `${target.name || "未命名目标"} · ${tag}` : target.name || "未命名目标";
        return `<option value="${escapeAttr(value)}" ${isSelected ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    const unknownSelected = selected && !selectedKnown ? `<option value="${escapeAttr(selected)}" selected>已关联目标</option>` : "";
    return `<option value="">不关联目标</option>${unknownSelected}${options}`;
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

  function renderRecordSummaries() {
    const dates = recentRecordChartDates();
    return `
      <section class="summary-scope-card active-summary-scope">
        ${renderLocationBreakdownCard(locationBreakdownForDates(dates), "地点时间占比", "所选范围还没有地点时间。")}
        ${renderRecordTrendChart(dates)}
        <div class="stat-list habit-rate-row">
          <div class="stat-row">
            <span>习惯平均达标率</span>
            <strong>${habitRateForDates(dates)}%</strong>
          </div>
        </div>
      </section>
    `;
  }

  function recentRecordChartDates() {
    return weekKeys(ui.recordChartWindowOffset);
  }

  function recordChartRangeText() {
    const dates = recentRecordChartDates();
    return `${dates[0]} 至 ${dates[dates.length - 1]}`;
  }

  function weekKeys(offset = ui.recordChartWindowOffset || 0) {
    const endKey = offsetDateKey(latestRecordKey(), offset);
    return weekKeysEndingAt(endKey);
  }

  function offsetDateKey(key, offset) {
    return isoFromDate(addDays(parseDateKey(key), -Math.max(0, Number(offset) || 0)));
  }

  function weekKeysEndingAt(endKey) {
    const endDate = parseDateKey(endKey);
    return Array.from({ length: 7 }, (_, index) => {
      return isoFromDate(addDays(endDate, index - 6));
    });
  }

  function latestRecordKey() {
    const candidates = new Set();
    Object.entries(state.logs || {}).forEach(([key, logs]) => {
      if (!normalizeDateKey(key)) return;
      if ((logs || []).some((entry) => Number(entry.minutes) > 0)) candidates.add(key);
    });
    Object.entries(state.locationLogs || {}).forEach(([key, locations]) => {
      if (!normalizeDateKey(key)) return;
      if (normalizeLocationRecords(locations).records.some((entry) => entry.start || entry.end)) candidates.add(key);
    });
    (state.habits || []).forEach((habit) => {
      Object.entries(habit.records || {}).forEach(([key, value]) => {
        if (normalizeDateKey(key) && Number(value) > 0) candidates.add(key);
      });
    });
    return Array.from(candidates)
      .filter((key) => studySummaryForDates([key]).total > 0 || workSummaryForDates([key]).total > 0 || habitRateForDates([key]) > 0)
      .sort()
      .at(-1) || dateKey();
  }

  function renderRecordChartControls() {
    const labels = ui.recordChartSeries;
    const items = [
      ["work", "工位具体时间"],
      ["study", "学习具体时间"],
      ["efficiency", "效率数值"],
    ];
    return `
      <div class="record-chart-controls" aria-label="汇总图表数字标注">
        ${items
          .map(
            ([key, label]) => `
              <label>
                <input class="checkbox" type="checkbox" data-action="toggle-record-chart-series" data-series="${key}" ${labels[key] ? "checked" : ""} />
                <span>${label}</span>
              </label>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderRecordTrendChart(dates) {
    const data = recordChartData(dates);
    const labels = ui.recordChartSeries;
    const expected = expectedHourTargets();
    const hasVisibleData = data.some((item) => item.study > 0 || (item.work !== null && item.work > 0) || (item.efficiency !== null && item.efficiency > 0));
    const hasExpectedData = expected.study > 0 || expected.work > 0;
    if (!data.length || (!hasVisibleData && !hasExpectedData)) {
      return `
        <section class="record-trend-card">
          <div class="record-trend-scroll record-trend-empty-wrap" data-record-chart-drag="true">
            <p class="empty compact-empty">所选范围还没有可绘制的数据。</p>
          </div>
        </section>
      `;
    }

    const width = 520;
    const height = 310;
    const margin = { top: 34, right: 44, bottom: 52, left: 42 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const visibleHourValues = data.flatMap((item) => [item.work ?? 0, item.study, expected.study, expected.work]);
    const maxHour = Math.max(1, Math.ceil(Math.max(...visibleHourValues) * 1.22));
    const step = chartWidth / data.length;
    const groupWidth = Math.min(28, Math.max(18, step * 0.46));
    const studyWidth = groupWidth;
    const yHour = (value) => margin.top + chartHeight - (value / maxHour) * chartHeight;
    const yPercent = (value) => margin.top + chartHeight - (clamp(value, 0, 100) / 100) * chartHeight;
    const xCenter = (index) => margin.left + step * index + step / 2;
    const barColor = { work: "#39bff2", study: getStudyTag()?.color || "#2f6f73" };
    const studyFillColor = barColor.work;
    const hourTicks = [0, maxHour / 2, maxHour];
    const percentTicks = [0, 50, 100];
    const labelEvery = Math.max(1, Math.ceil(data.length / 8));
    const efficiencyLinePoints = data
      .map((item, index) => (item.efficiency === null ? "" : `${xCenter(index)},${yPercent(item.efficiency)}`))
      .filter(Boolean)
      .join(" ");
    const expectedLines = [
      expected.work > 0 ? { key: "work", value: expected.work, color: barColor.work, label: `期望 ${formatChartHourValue(expected.work)}` } : null,
      expected.study > 0 ? { key: "study", value: expected.study, color: barColor.study, label: `期望 ${formatChartHourValue(expected.study)}` } : null,
    ].filter(Boolean);

    return `
      <section class="record-trend-card">
        <div class="record-trend-scroll" data-record-chart-drag="true">
        <svg class="record-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="学习时间统计：工位时长、学习时长和工位时间利用率">
          <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}" />
          <line class="chart-axis" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" />
          <line class="chart-axis" x1="${margin.left + chartWidth}" y1="${margin.top}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}" />
          <text class="chart-axis-title" x="${margin.left - 28}" y="${margin.top - 8}">h</text>
          <text class="chart-axis-title" x="${margin.left + chartWidth + 24}" y="${margin.top - 8}">%</text>
          ${hourTicks
            .map((tick) => {
              const y = yHour(tick);
              return `
                <line class="chart-grid" x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}" />
                <text class="chart-y-label left" x="${margin.left - 8}" y="${y + 4}">${formatChartHourTick(tick)}</text>
              `;
            })
            .join("")}
          ${percentTicks
            .map((tick) => {
              const y = yPercent(tick);
              return `<text class="chart-y-label right" x="${margin.left + chartWidth + 8}" y="${y + 4}">${tick}%</text>`;
            })
            .join("")}
          ${expectedLines
            .map((line) => {
              const y = yHour(line.value);
              return `<line class="chart-expected-line" x1="${margin.left}" y1="${y}" x2="${margin.left + chartWidth}" y2="${y}" style="stroke:${line.color}" />`;
            })
            .join("")}
          ${data.map((item, index) => renderRecordChartColumnShapes(item, index, { margin, chartHeight, groupWidth, studyWidth, yHour, xCenter, studyFillColor })).join("")}
          ${efficiencyLinePoints ? `<polyline class="chart-efficiency-line" points="${efficiencyLinePoints}" />` : ""}
          ${data
            .map((item, index) => {
              if (item.efficiency === null) return "";
              const cx = xCenter(index);
              const cy = yPercent(item.efficiency);
              return `<circle class="chart-efficiency-dot" cx="${cx}" cy="${cy}" r="4.2" />`;
            })
            .join("")}
          ${data
            .map((item, index) => {
              const show = index === 0 || index === data.length - 1 || index % labelEvery === 0;
              return show ? `<text class="chart-x-label" x="${xCenter(index)}" y="${height - 20}">${escapeHtml(item.label)}</text>` : "";
            })
            .join("")}
          <g class="chart-value-layer">
            ${expectedLines
              .map((line) => {
                const y = yHour(line.value);
                return `<text class="chart-expected-label" x="${margin.left + chartWidth - 4}" y="${Math.max(margin.top + 14, y - 7)}" style="fill:${line.color}">${escapeHtml(line.label)}</text>`;
              })
              .join("")}
            ${data.map((item, index) => renderRecordChartColumnLabels(item, index, { margin, groupWidth, studyWidth, yHour, xCenter, labels })).join("")}
            ${data
              .map((item, index) => {
                if (item.efficiency === null || !labels.efficiency) return "";
                const cx = xCenter(index);
                const cy = yPercent(item.efficiency);
                return `<text class="chart-efficiency-label" x="${cx + 8}" y="${Math.max(margin.top + 12, cy + 4)}">${item.efficiency}%</text>`;
              })
              .join("")}
          </g>
        </svg>
        </div>
        <div class="record-trend-legend">
          <span><i class="hollow" style="color:${barColor.work}"></i>工位时长</span>
          <span><i style="background:${studyFillColor}"></i>学习填充</span>
          <span><i class="line"></i>工位时间利用率</span>
          ${expected.work > 0 ? `<span><i class="dash" style="color:${barColor.work}"></i>期望工位</span>` : ""}
          ${expected.study > 0 ? `<span><i class="dash" style="color:${getStudyTag()?.color || "#2f6f73"}"></i>期望学习</span>` : ""}
        </div>
      </section>
    `;
  }

  function recordChartData(dates) {
    return dates.map((itemDate) => {
      const holiday = isHolidayDate(itemDate);
      const study = studySummaryForDates([itemDate]).total / 60;
      const work = holiday ? null : workSummaryForDates([itemDate]).total / 60;
      return {
        date: itemDate,
        label: monthDayText(itemDate),
        holiday,
        study,
        work,
        efficiency: holiday ? null : work > 0 ? clamp(Math.round((study / work) * 100), 0, 100) : 0,
      };
    });
  }

  function renderRecordChartColumnShapes(item, index, config) {
    const { groupWidth, studyWidth, yHour, xCenter, studyFillColor } = config;
    const center = xCenter(index);
    const baseline = config.margin.top + config.chartHeight;
    const workValue = item.work;
    const studyValue = item.study;
    const parts = [];
    if (studyValue > 0) {
      const hasWorkCup = workValue !== null && workValue > 0;
      const cupValue = hasWorkCup ? workValue : studyValue;
      const fillValue = hasWorkCup ? Math.min(studyValue, workValue) : studyValue;
      const cupY = yHour(cupValue);
      const fillY = yHour(fillValue);
      const cupHeight = Math.max(2, baseline - cupY);
      const x = center - studyWidth / 2;
      const clipId = `chart-water-clip-${index}`;
      const frozen = !hasWorkCup || studyValue >= workValue;
      parts.push(`
        <defs>
          <clipPath id="${clipId}">
            <rect x="${x + 1}" y="${cupY + 1}" width="${Math.max(1, studyWidth - 2)}" height="${Math.max(1, cupHeight - 1)}" />
          </clipPath>
        </defs>
        ${
          frozen
            ? renderChartFrozenColumn(x, cupY, studyWidth, cupHeight, clipId)
            : `<g clip-path="url(#${clipId})">
                <path class="chart-bar-study-fill chart-water-layer" d="${waterFillPath(x, fillY, studyWidth, baseline)}" style="fill:${studyFillColor}" />
              </g>`
        }
      `);
    }
    if (workValue !== null && workValue > 0) {
      const y = yHour(workValue);
      const height = Math.max(2, baseline - y);
      const x = center - groupWidth / 2;
      parts.push(`<rect class="chart-bar-work-outline" x="${x}" y="${y}" width="${groupWidth}" height="${height}" />`);
    }
    return parts.join("");
  }

  function renderRecordChartColumnLabels(item, index, config) {
    const { margin, groupWidth, studyWidth, yHour, xCenter, labels } = config;
    const center = xCenter(index);
    const workValue = item.work;
    const studyValue = item.study;
    const parts = [];
    if (studyValue > 0 && labels.study) {
      const hasWorkCup = workValue !== null && workValue > 0;
      const cupValue = hasWorkCup ? workValue : studyValue;
      const x = center - studyWidth / 2;
      const labelY = hasWorkCup && studyValue >= workValue ? yHour(cupValue) : yHour(studyValue);
      parts.push(`<text class="chart-value-label chart-study-label" x="${x - 4}" y="${Math.max(margin.top + 12, labelY + 4)}">${formatChartHourValue(studyValue)}</text>`);
    }
    if (workValue !== null && workValue > 0 && labels.work) {
      const y = yHour(workValue);
      parts.push(`<text class="chart-value-label chart-work-label" x="${center}" y="${Math.max(margin.top + 12, y - 6)}">${formatChartHourValue(workValue)}</text>`);
    }
    return parts.join("");
  }

  function waterFillPath(x, y, width, baseline) {
    const height = Math.max(2, baseline - y);
    const inset = Math.min(2.4, width * 0.12, height * 0.2);
    const centerDrop = Math.min(1.5, inset * 0.72);
    const middleY = y + inset;
    const right = x + width;
    return [
      `M ${x} ${baseline}`,
      `L ${x} ${y}`,
      `L ${x + inset} ${middleY}`,
      `Q ${x + width / 2} ${middleY + centerDrop} ${right - inset} ${middleY}`,
      `L ${right} ${y}`,
      `L ${right} ${baseline}`,
      "Z",
    ].join(" ");
  }

  function renderChartFrozenColumn(x, y, width, height, clipId) {
    return `
      <g clip-path="url(#${clipId})">
        <rect class="chart-bar-study-fill chart-ice-column" x="${x}" y="${y}" width="${width}" height="${height}" />
      </g>
    `;
  }

  function formatChartHourTick(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function formatChartHourValue(value) {
    const rounded = Math.round((Number(value) || 0) * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
  }

  function chartLineSegments(items, predicate, pointForItem) {
    const segments = [];
    let current = [];
    items.forEach((item, index) => {
      if (predicate(item, index)) {
        current.push(pointForItem(item, index));
        return;
      }
      if (current.length) segments.push(current.join(" "));
      current = [];
    });
    if (current.length) segments.push(current.join(" "));
    return segments;
  }

  function expectedHourTargets() {
    return {
      study: state.settings.expectedStudyVisible === false ? 0 : Number(state.settings.expectedStudyHours) || 0,
      work: state.settings.expectedWorkVisible === false ? 0 : Number(state.settings.expectedWorkHours) || 0,
    };
  }

  function renderWorkEfficiencyStrip(scope = "day", date = dateKey()) {
    const dates = datesInScope(scope, date);
    const study = studySummaryForDates(dates).total;
    const work = workSummaryForDates(dates).total;
    const percent = workEfficiencyPercent(study, work);
    const isHoliday = scope === "day" && isHolidayDate(date);
    if (isHoliday) {
      return `
        <div class="efficiency-strip holiday-efficiency-strip">
          <strong>假期</strong>
          <span>学习 ${formatDuration(study)}</span>
        </div>
      `;
    }
    return `
      <div class="efficiency-strip">
        <span>学习 ${formatDuration(study)}</span>
        <span>工位 ${formatDuration(work)}</span>
        <strong>工位时间利用率 ${percent}%</strong>
      </div>
    `;
  }

  function workEfficiencyPercent(studyMinutes, workMinutes) {
    return workMinutes > 0 ? Math.round((studyMinutes / workMinutes) * 100) : 0;
  }

  function renderExecute() {
    state.targetScope = "day";
    const targets = targetsForCurrentScope();
    const targetTags = targetTagList(targets);
    if (ui.targetFilterTag !== "__all" && !targetTags.includes(ui.targetFilterTag)) ui.targetFilterTag = "__all";
    $("#app").innerHTML = `
      <section class="view" data-view="execute">
        ${renderTargetTagBar(targetTags)}
        <section class="section-band target-section">
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

        <section class="section-band habit-section">
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
    const targets = targetsForCurrentScope();
    return `
      <section class="section-band target-filter-band">
        <div class="target-tag-tabs">
          <button class="target-tag-chip ${ui.targetFilterTag === "__all" ? "active" : ""}" type="button" data-action="set-target-filter" data-tag="__all">全部（${targets.length}）</button>
          ${tags.map((tag) => `<button class="target-tag-chip ${ui.targetFilterTag === tag ? "active" : ""}" type="button" data-action="set-target-filter" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}（${targetCountForTag(targets, tag)}）</button>`).join("")}
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
          <span>${escapeHtml(tag)}（${targets.length}）</span>
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
            <p class="task-spent">记录时长 ${formatDuration(targetLoggedMinutes(target))}</p>
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
        <span class="date-display-field">${escapeHtml(reviewNavigatorDisplay(scope, date))}</span>
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
        <div class="review-tab-toolbar">
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
        </div>
      </section>
    `;
  }

  function renderReviewScopeSection(scope) {
    if (scope === "week") return renderWeeklyReviewSection();
    if (scope === "month") return renderMonthlyReviewSection();
    const date = reviewDate(scope);
    const reviewItems = reviewsForScope(scope, date);
    const holiday = isHolidayDate(date);
    return `
      <section class="section-band review-scope-section" data-review-scope="${scope}">
        ${renderReviewNavigator(scope)}
        <div class="section-title">
          <div>
            <h2>${reviewLabel(scope)}${holiday ? `<span class="holiday-inline-badge">假期</span>` : ""}</h2>
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
        ${renderReviewDueReminder(date)}
      </section>
    `;
  }

  function renderReviewDueReminder(date) {
    const reminders = [];
    if (isSunday(date) && !hasCompletedWeeklyReviewForDate(date)) reminders.push("该进行周复盘了！");
    if (isLastDayOfMonth(date) && !hasCompletedMonthlyReviewForDate(date)) reminders.push("该进行月复盘了！");
    if (!reminders.length) return "";
    return `
      <div class="review-due-reminder" role="note">
        ${reminders.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
      </div>
    `;
  }

  function hasCompletedWeeklyReviewForDate(date) {
    return weeklyReviewHasText(readWeeklyReviewForKey(scopeKey("week", date)));
  }

  function hasCompletedMonthlyReviewForDate(date) {
    return monthlyReviewHasText(normalizeMonthlyReview(state.monthlyReviews?.[scopeKey("month", date)] || {}));
  }

  function renderWeeklyReviewSection() {
    const scope = "week";
    const date = reviewDate(scope);
    const key = scopeKey(scope, date);
    const review = weeklyReviewForKey(key);
    const holidaySummary = weeklyHolidaySummaryText(date);
    return `
      <section class="section-band review-scope-section weekly-review-section" data-review-scope="${scope}">
        ${renderReviewNavigator(scope)}
        <div class="section-title">
          <div>
            <h2>${reviewLabel(scope)}</h2>
            <p class="hint">${scopeDisplay(scope, date)}</p>
            ${holidaySummary ? `<p class="holiday-summary-text">${escapeHtml(holidaySummary)}</p>` : ""}
          </div>
        </div>
        ${renderWeeklyReviewSummary(date, { omitEmpty: true })}
        ${renderLocationBreakdownCard(locationBreakdownForDates(datesInScope("week", date)), "地点时间占比", "本周还没有地点时间。")}
        ${renderStudyBreakdownCard(weeklyStudyBreakdown(date), "学习标签占比", "本周还没有学习记录。")}
        ${renderWeeklyKeyEvents(date)}
        ${renderWeeklyReviewEditor(review, key)}
      </section>
    `;
  }

  function renderWeeklyReviewSummary(date, options = {}) {
    const study = weeklyStudySummary(date);
    const work = weeklyWorkSummary(date);
    const lines = [
      study.total > 0 || !options.omitEmpty ? renderWeeklyBriefLine("学习时长", study.total, study.recordedDays) : "",
      work.total > 0 || !options.omitEmpty ? renderWeeklyBriefLine("工位时长", work.total, work.recordedDays) : "",
      work.total > 0 || !options.omitEmpty ? `<p><strong>工位时间利用率：</strong>${workEfficiencyPercent(study.total, work.total)}%</p>` : "",
    ].join("");
    if (!lines) return "";
    return `
      <div class="weekly-brief-summary">
        ${lines}
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
    const holidaySummary = monthlyHolidaySummaryText(date);
    return `
      <section class="section-band review-scope-section monthly-review-section" data-review-scope="${scope}">
        ${renderReviewNavigator(scope)}
        <div class="section-title">
          <div>
            <h2>${reviewLabel(scope)}</h2>
            <p class="hint">${scopeDisplay(scope, date)}</p>
            ${holidaySummary ? `<p class="holiday-summary-text">${escapeHtml(holidaySummary)}</p>` : ""}
          </div>
        </div>
        ${renderMonthlyStatsTable(date)}
        ${renderLocationBreakdownCard(locationBreakdownForDates(datesInScope("month", date)), "地点时间占比", "本月还没有地点时间。")}
        ${renderStudyBreakdownCard(monthlyStudyBreakdown(date), "学习标签占比（月）", "本月还没有学习记录。")}
        ${renderMonthlyReviewTabs()}
        ${renderMonthlyReviewPanel(review, key, date)}
      </section>
    `;
  }

  function renderStudyBreakdownCard(breakdown, title, emptyText) {
    return renderShareBreakdownCard(breakdown, title, emptyText, "学习标签占比");
  }

  function renderLocationBreakdownCard(breakdown, title, emptyText) {
    return renderShareBreakdownCard(breakdown, title, emptyText, "地点时间占比");
  }

  function renderShareBreakdownCard(breakdown, title, emptyText, ariaLabel) {
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
        <div class="weekly-stacked-bar" aria-label="${escapeAttr(ariaLabel)}">
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
                  ${escapeHtml(entry.label)} ${entry.percent}%${entry.valueText ? ` · ${escapeHtml(entry.valueText)}` : ""}
                </span>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderMonthlyStatsTable(date, options = {}) {
    const buckets = monthWeekBuckets(date)
      .map((bucket, index) => ({ ...bucket, index }))
      .filter((bucket) => {
        if (!options.omitEmptyRows) return true;
        const study = studySummaryForDates(bucket.dates);
        const work = workSummaryForDates(bucket.dates);
        return study.total > 0 || work.total > 0;
      });
    if (!buckets.length) return "";
    return `
      <section class="monthly-table-card">
        <table class="monthly-stats-table">
          <thead>
            <tr>
              <th>周次</th>
              <th>学习时长（日均）</th>
              <th>工位时长（日均）</th>
              <th>工位时间利用率</th>
            </tr>
          </thead>
          <tbody>
            ${buckets
              .map((bucket) => {
                const study = studySummaryForDates(bucket.dates);
                const work = workSummaryForDates(bucket.dates);
                const studyAverage = study.recordedDays ? study.total / study.recordedDays : 0;
                const workAverage = work.recordedDays ? work.total / work.recordedDays : 0;
                return `
                  <tr>
                    <td>第${bucket.index + 1}周</td>
                    <td>${formatHourShortText(study.total)}（${formatHourShortText(studyAverage)}）</td>
                    <td>${formatHourShortText(work.total)}（${formatHourShortText(workAverage)}）</td>
                    <td>${workEfficiencyPercent(study.total, work.total)}%</td>
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
          .map(([mode, label]) => `<button class="toggle-button traffic-tab ${mode} ${ui.monthReviewMode === mode ? "active" : ""}" type="button" data-action="set-month-review-mode" data-mode="${mode}">${label}</button>`)
          .join("")}
      </div>
    `;
  }

  function renderWeeklyKeyEvents(date) {
    const events = keyEventsForDates(datesInScope("week", date));
    const holidaySummary = weeklyHolidaySummaryText(date);
    return `
      <section class="monthly-key-card">
        <div class="weekly-card-title">
          <i class="weekly-icon amber"></i>
          <strong>本周关键事件</strong>
          <span>${escapeHtml(holidaySummary || "来自日复盘星标，默认只显示日期和现象，点按可展开原因和措施。")}</span>
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
          <span><strong>${escapeHtml(shortDateWeekdayText(event.date))}</strong>${escapeHtml(event.phenomenon || "还没有写现象")}</span>
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
    if (ui.monthReviewMode === "summary") return renderMonthlySummaryPanel(review, key, date);
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

  function renderMonthlyLightList(mode, date, options = {}) {
    const label = mode === "red" ? "红灯" : "绿灯";
    const buckets = monthWeekBuckets(date)
      .map((bucket, index) => ({ ...bucket, index, value: readWeeklyReviewForKey(bucket.key)[mode] || "" }))
      .filter((bucket) => !options.omitEmpty || bucket.value.trim());
    if (!buckets.length) return "";
    return `
      <div class="monthly-light-list">
        ${buckets
          .map((bucket) => {
            return `
              <article class="monthly-light-item ${mode}">
                <strong>第${bucket.index + 1}周 · ${label}</strong>
                <p class="review-text">${bucket.value ? escapeMultiline(bucket.value) : `这一周还没有填写${label}`}</p>
              </article>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderMonthlySummaryPanel(review, key, date) {
    return `
      <div class="monthly-summary-stack">
        ${renderMonthlyWeeklySummaryList(date)}
        <section class="monthly-next-card">
          <div class="weekly-card-title"><i class="weekly-icon amber"></i><strong>总结</strong></div>
          ${renderMonthlyTextField("总结", "summary", review.summary, key, "这个月最需要记住的结论、模式或变化")}
        </section>
        <section class="monthly-next-card">
          <div class="weekly-card-title"><i class="weekly-icon blue"></i><strong>下月拟改进</strong></div>
          ${renderMonthlyTextField("下月拟改进的方向", "nextDirection", review.nextDirection, key, "下个月最想优先调整或推进的方向")}
        </section>
      </div>
    `;
  }

  function renderMonthlyWeeklySummaryList(date, options = {}) {
    const buckets = monthWeekBuckets(date)
      .map((bucket, index) => ({ ...bucket, index, summary: readWeeklyReviewForKey(bucket.key).summary || "" }))
      .filter((bucket) => !options.omitEmpty || bucket.summary.trim());
    if (!buckets.length) return "";
    return `
      <section class="monthly-key-card">
        <div class="weekly-card-title">
          <i class="weekly-icon amber"></i>
          <strong>当月总结</strong>
          <span>来自本月各周周复盘里的“总结”。</span>
        </div>
        <div class="monthly-light-list">
          ${buckets
            .map((bucket) => {
              return `
                <article class="monthly-light-item summary">
                  <strong>第${bucket.index + 1}周 · 总结</strong>
                  <p class="review-text">${bucket.summary ? escapeMultiline(bucket.summary) : "这一周还没有填写总结"}</p>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
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
    return `
      <label class="form-row monthly-text-field">
        ${label ? `<span class="field-label">${escapeHtml(label)}</span>` : ""}
        ${renderBulletTextarea({
          tone: bulletToneForField(field),
          value,
          action: "update-month-review",
          keyName: "data-month-review-key",
          key,
          field,
          placeholder,
        })}
      </label>
    `;
  }

  function renderWeeklyReviewDisplay(review) {
    return `
      <h3 class="weekly-section-heading">红绿灯自评</h3>
      <div class="weekly-reflection-grid">
        ${renderWeeklyReflectionCard("red", "红灯", "本周感到挫败和消耗能量的事", review.red)}
        ${renderWeeklyReflectionCard("green", "绿灯", "本周最有成就感/最顺利的事", review.green)}
      </div>
      <section class="weekly-next-card">
        <div class="weekly-card-title"><i class="weekly-icon amber"></i><strong>下周拟改进</strong></div>
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
          ${renderBulletTextarea({ tone: "red", value: review.red, action: "update-week-review", keyName: "data-weekly-review-key", key, field: "red", placeholder: "写下本周让你挫败、卡住、消耗能量的事情" })}
        </label>
        <label class="form-row">
          <span class="field-label green-field">绿灯：本周最有成就感/最顺利的事</span>
          ${renderBulletTextarea({ tone: "green", value: review.green, action: "update-week-review", keyName: "data-weekly-review-key", key, field: "green", placeholder: "写下本周最顺利、最有成就感的事情" })}
        </label>
        <label class="form-row">
          <span class="field-label amber-field">总结</span>
          ${renderBulletTextarea({ tone: "amber", value: review.summary, action: "update-week-review", keyName: "data-weekly-review-key", key, field: "summary", placeholder: "这一周最需要记住的结论、模式或变化" })}
        </label>
        <label class="form-row">
          <span class="field-label blue-field">下周拟改进的方向</span>
          ${renderBulletTextarea({ tone: "blue", value: review.nextDirection, action: "update-week-review", keyName: "data-weekly-review-key", key, field: "nextDirection", placeholder: "下周想优先调整或推进的方向" })}
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
        <span class="date-display-field">${escapeHtml(reviewNavigatorDisplay(scope, date))}</span>
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
    prepareTextareas(backdrop);
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

  function openExportModal(scope = state.activeTab) {
    const exportScope = normalizeExportScope(scope);
    const defaults = defaultExportItems(exportScope);
    openModal(
      `${exportScopeTitle(exportScope)}导出`,
      `
        <p class="hint">勾选内容后生成渲染级预览图，可复制或保存为图片。</p>
        <div class="export-scope-grid">
          ${renderExportOptions(defaults, exportScope)}
        </div>
        <div class="button-row export-action-row">
          <button class="secondary-button" type="button" data-modal-action="copy-export-image">复制图片</button>
          <button class="primary-button" type="button" data-modal-action="save-export-image">保存图片</button>
        </div>
        <p id="export-status" class="export-status" role="status"></p>
        <div class="export-preview-wrap">
          <img id="export-image" alt="导出预览" />
          <p id="export-empty" class="empty compact-empty hidden">请至少勾选一项内容。</p>
        </div>
      `,
      (backdrop) => {
        let exportPreviewTicket = 0;
        let latestExportResult = null;
        let latestExportValues = [];
        const status = $("#export-status", backdrop);
        const setExportStatus = (message, tone = "") => {
          if (!status) return;
          status.textContent = message || "";
          status.dataset.tone = tone;
        };
        const selectedExportItems = () => $$("input[name='export-item']:checked", backdrop).map((input) => input.value);
        const showExportCanvasPreview = (canvas) => {
          const image = $("#export-image", backdrop);
          const empty = $("#export-empty", backdrop);
          image.src = canvas.toDataURL("image/png");
          image.classList.remove("hidden");
          empty.classList.add("hidden");
        };
        const updatePreview = async () => {
          const ticket = ++exportPreviewTicket;
          const items = selectedExportItems();
          const enabledCount = $$("input[name='export-item']:not(:disabled)", backdrop).length;
          const image = $("#export-image", backdrop);
          const empty = $("#export-empty", backdrop);
          latestExportResult = null;
          latestExportValues = items;
          if (!items.length) {
            image.removeAttribute("src");
            image.classList.add("hidden");
            empty.textContent = enabledCount ? "请至少勾选一项内容。" : "当前页暂无可导出内容。";
            empty.classList.remove("hidden");
            setExportStatus("");
            return;
          }
          image.classList.add("hidden");
          empty.textContent = "正在生成预览图...";
          empty.classList.remove("hidden");
          setExportStatus("");
          try {
            const result = await createExportCanvas(items, exportScope);
            if (ticket !== exportPreviewTicket) return;
            latestExportResult = result;
            latestExportValues = items;
            showExportCanvasPreview(result.canvas);
          } catch (error) {
            console.warn(error);
            if (ticket !== exportPreviewTicket) return;
            empty.textContent = `图片生成失败：${error.message || error}`;
            setExportStatus(error.message || "图片生成失败。", "error");
          }
        };
        const exportSelectedImages = async (mode) => {
          const items = selectedExportItems();
          if (!items.length) {
            setExportStatus("请至少选择一项。", "error");
            return;
          }
          try {
            setExportStatus(mode === "copy" ? "正在生成并复制图片..." : "正在生成并保存图片...");
            const result = latestExportResult && sameExportItems(items, latestExportValues)
              ? latestExportResult
              : await createExportCanvas(items, exportScope);
            latestExportResult = result;
            latestExportValues = items;
            showExportCanvasPreview(result.canvas);
            if (mode === "copy") {
              await copyCanvasImage(result.canvas);
              setExportStatus("已复制图片。", "success");
            } else {
              const filename = result.items.length === 1 ? `${sanitizeFilename(result.items[0].name)}.png` : "导出长图.png";
              await saveCanvasImage(result.canvas, filename);
              setExportStatus("已打开保存/分享面板。", "success");
            }
          } catch (error) {
            console.warn(error);
            setExportStatus(error.message || "导出失败。", "error");
          }
        };
        backdrop.addEventListener("change", (event) => {
          if (event.target.name === "export-item") updatePreview();
        });
        backdrop.addEventListener("click", (event) => {
          const action = event.target.dataset.modalAction;
          if (action === "copy-export-image") exportSelectedImages("copy");
          if (action === "save-export-image") exportSelectedImages("save");
        });
        updatePreview();
      },
    );
  }

  function normalizeExportScope(scope) {
    return ["record", "execute", "review"].includes(scope) ? scope : state.activeTab;
  }

  function exportScopeTitle(scope) {
    return { record: "记录页", execute: "执行页", review: "复盘页" }[scope] || "当前页";
  }

  function defaultExportItems(scope = state.activeTab) {
    if (scope === "execute") return new Set(["execute-targets", "execute-habits"]);
    if (scope === "review") return new Set([`review-${state.reviewScope || "day"}`]);
    return new Set(["record-logs", "record-summary"]);
  }

  function exportOptionGroups(scope) {
    if (scope === "execute") {
      return [
        [
          "执行",
          [
            ["execute-targets", "目标情况", scopeDisplay("day", dateKey())],
            ["execute-habits", "习惯情况", habitTrailRangeText()],
          ],
        ],
      ];
    }
    if (scope === "review") {
      const reviewItems = {
        day: [["review-day", "日复盘", scopeDisplay("day", reviewDate("day"))]],
        week: [
          ["review-week", "周复盘", reviewNavigatorDisplay("week", reviewDate("week"))],
        ],
        month: [
          ["review-month", "月复盘", scopeDisplay("month", reviewDate("month"))],
          ["review-month-red", "月红灯情况", scopeDisplay("month", reviewDate("month"))],
          ["review-month-green", "月绿灯情况", scopeDisplay("month", reviewDate("month"))],
        ],
      }[state.reviewScope || "day"];
      return [["复盘", reviewItems]];
    }
    return [
      [
        "记录",
        [
          ["record-logs", "今日时间记录", `${dateKey()} ${weekdayText(dateKey())}`],
          ["record-summary", "学习时间统计", recordChartRangeText()],
        ],
      ],
    ];
  }

  function exportItemName(item) {
    const names = {
      "record-logs": "今日时间记录",
      "record-location": "地点时间",
      "record-summary": "学习时间统计",
      "execute-targets": "目标情况",
      "execute-habits": "习惯情况",
      "review-day": "日复盘",
      "review-week": "周复盘",
      "review-month": "月复盘",
      "review-month-red": "月红灯情况",
      "review-month-green": "月绿灯情况",
    };
    return names[item] || "导出图片";
  }

  function exportItemMeta(item, scope = state.activeTab) {
    if (item === "record-logs") return `${dateKey()} ${weekdayText(dateKey())}`;
    if (item === "record-summary") return recordChartRangeText();
    if (item === "execute-targets") return scopeDisplay("day", dateKey());
    if (item === "execute-habits") return habitTrailRangeText();
    if (item === "review-day") return scopeDisplay("day", reviewDate("day"));
    if (item === "review-week") return reviewNavigatorDisplay("week", reviewDate("week"));
    if (item === "review-month" || item === "review-month-red" || item === "review-month-green") return scopeDisplay("month", reviewDate("month"));
    return exportScopeTitle(scope);
  }

  function renderExportOptions(defaults, scope) {
    const groups = exportOptionGroups(scope);
    return groups
      .map(
        ([title, items]) => `
          <section class="export-option-group">
            <h3>${title}</h3>
            ${items
              .map(
                ([value, label, meta]) => {
                  const enabled = hasExportData(value);
                  return `
                  <label class="export-scope-option ${enabled ? "" : "disabled"}">
                    <input class="checkbox" type="checkbox" name="export-item" value="${value}" ${defaults.has(value) && enabled ? "checked" : ""} ${enabled ? "" : "disabled"} />
                    <span>${escapeHtml(label)}</span>
                    <small>${enabled ? escapeHtml(meta) : "暂无内容"}</small>
                  </label>
                `;
                },
              )
              .join("")}
          </section>
        `,
      )
      .join("");
  }

  function hasExportData(item) {
    const day = dateKey();
    if (item === "record-logs") return (state.logs[day] || []).some((entry) => Number(entry.minutes) > 0 || entry.note || entry.targetId);
    if (item === "record-location") return locationEntriesForDate(day, locationRecordsForDate(day)).some((entry) => entry.type && (entry.start || entry.end));
    if (item === "record-summary") return hasRecordSummaryExportData();
    if (item === "execute-targets") return targetsForCurrentScope().length > 0;
    if (item === "execute-habits") return state.habits.length > 0;
    if (item === "review-day") return reviewItemsForExport("day", reviewDate("day")).some(reviewItemHasContent);
    if (item === "review-week") return hasWeeklyReviewExportData(reviewDate("week"));
    if (item === "review-month") return hasMonthlyReviewExportData(reviewDate("month"));
    if (item === "review-month-red") return hasMonthlyLightExportData("red", reviewDate("month"));
    if (item === "review-month-green") return hasMonthlyLightExportData("green", reviewDate("month"));
    return false;
  }

  function hasRecordSummaryExportData() {
    const dates = recentRecordChartDates();
    return (
      locationBreakdownForDates(dates).total > 0 ||
      dates.some((itemDate) => studySummaryForDates([itemDate]).total > 0 || workSummaryForDates([itemDate]).total > 0) ||
      habitRateForDates(dates) > 0
    );
  }

  function hasHabitDataForScope(scope, date) {
    const dates = datesInScope(scope, date);
    return state.habits.some((habit) => dates.some((itemDate) => Object.prototype.hasOwnProperty.call(habit.records || {}, itemDate)));
  }

  function reviewItemsForExport(scope, date) {
    return (state.reviews?.[scope]?.[scopeKey(scope, date)] || []).map(normalizeReviewItem);
  }

  function reviewItemHasContent(item) {
    return Boolean(
      item?.phenomenon?.trim() ||
        (item?.reasons || []).some((reason) => reason?.text?.trim() || reason?.measure?.trim()),
    );
  }

  function weeklyReviewHasText(review) {
    return Boolean(review.red?.trim() || review.green?.trim() || review.summary?.trim() || review.nextDirection?.trim());
  }

  function monthlyReviewHasText(review) {
    return Boolean(review.redInsight?.trim() || review.greenInsight?.trim() || review.summary?.trim() || review.nextDirection?.trim());
  }

  function hasWeeklyReviewExportData(date) {
    const key = scopeKey("week", date);
    return (
      locationBreakdownForDates(datesInScope("week", date)).total > 0 ||
      weeklyStudySummary(date).total > 0 ||
      weeklyWorkSummary(date).total > 0 ||
      weeklyStudyBreakdown(date).total > 0 ||
      weeklyReviewHasText(readWeeklyReviewForKey(key))
    );
  }

  function monthlyStatsHasData(date) {
    return monthWeekBuckets(date).some((bucket) => {
      const study = studySummaryForDates(bucket.dates);
      const work = workSummaryForDates(bucket.dates);
      return study.total > 0 || work.total > 0;
    });
  }

  function monthlyWeeklySummaryHasData(date) {
    return monthWeekBuckets(date).some((bucket) => readWeeklyReviewForKey(bucket.key).summary?.trim());
  }

  function hasMonthlyReviewExportData(date) {
    const key = scopeKey("month", date);
    const review = normalizeMonthlyReview(state.monthlyReviews?.[key] || {});
    return (
      monthlyStatsHasData(date) ||
      locationBreakdownForDates(datesInScope("month", date)).total > 0 ||
      monthlyStudyBreakdown(date).total > 0 ||
      monthlyWeeklySummaryHasData(date) ||
      Boolean(review.summary?.trim() || review.nextDirection?.trim())
    );
  }

  function hasMonthlyLightExportData(mode, date) {
    const key = scopeKey("month", date);
    const review = normalizeMonthlyReview(state.monthlyReviews?.[key] || {});
    const insight = mode === "red" ? review.redInsight : review.greenInsight;
    return Boolean(insight?.trim()) || monthWeekBuckets(date).some((bucket) => readWeeklyReviewForKey(bucket.key)[mode]?.trim());
  }

  async function createExportCanvas(items, scope = state.activeTab) {
    const exportItems = [];
    for (const item of items) {
      const canvas = await createExportItemCanvas(item, scope);
      if (canvas) exportItems.push({ name: exportItemName(item), canvas });
    }
    if (!exportItems.length) throw new Error("当前选择的内容没有可导出的渲染结果。");
    return {
      items: exportItems,
      canvas: exportItems.length === 1 ? exportItems[0].canvas : combineExportCanvases(exportItems.map((entry) => entry.canvas)),
    };
  }

  async function createExportItemCanvas(item, scope = state.activeTab) {
    const sourceCanvas = currentCanvasForExportItem(item);
    if (sourceCanvas) return assertExportCanvasReadable(makeChartExportCanvas(exportItemName(item), exportItemMeta(item, scope), sourceCanvas), exportItemName(item));
    const sourceSvg = currentSvgForExportItem(item);
    if (sourceSvg) return assertExportCanvasReadable(await makeSvgChartExportCanvas(exportItemName(item), exportItemMeta(item, scope), sourceSvg), exportItemName(item));
    const exportNode = buildSingleExportNode(item, scope);
    if (!exportNode) return null;
    const measureHost = document.createElement("div");
    measureHost.className = "review-export-measure";
    measureHost.style.width = `${exportCanvasCssWidth()}px`;
    measureHost.appendChild(exportNode);
    document.body.appendChild(measureHost);
    try {
      if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
      const width = Math.ceil(exportNode.scrollWidth);
      const height = Math.ceil(exportNode.scrollHeight);
      if (!width || !height) throw new Error(`${exportItemName(item)}图片生成失败：模块尺寸为空。`);
      try {
        return assertExportCanvasReadable(await renderNodeToCanvas(exportNode, width, height), exportItemName(item));
      } catch (error) {
        console.warn("Whole export render failed, trying chunks.", error);
        return await renderExportNodeInChunks(exportNode, item, error);
      }
    } finally {
      measureHost.remove();
    }
  }

  async function renderExportNodeInChunks(exportNode, item, originalError) {
    const chunks = exportChunkNodes(exportNode);
    const canvases = [];
    for (const chunk of chunks) {
      const chunkNode = buildExportChunkNode(chunk);
      const chunkHost = document.createElement("div");
      chunkHost.className = "review-export-measure";
      chunkHost.style.width = `${exportCanvasCssWidth()}px`;
      chunkHost.appendChild(chunkNode);
      document.body.appendChild(chunkHost);
      try {
        const width = Math.ceil(chunkNode.scrollWidth);
        const height = Math.ceil(chunkNode.scrollHeight);
        if (width && height) canvases.push(assertExportCanvasReadable(await renderNodeToCanvas(chunkNode, width, height), exportItemName(item)));
      } catch (error) {
        console.warn("Export chunk render failed.", error);
      } finally {
        chunkHost.remove();
      }
    }
    if (canvases.length) return combineExportCanvases(canvases);
    const manual = makeManualExportCanvas(item) || makeManualTextExportCanvas(item, exportNode);
    if (manual) return manual;
    throw new Error(`${exportItemName(item)}导出失败：${originalError?.message || "浏览器限制渲染"}`);
  }

  function buildExportChunkNode(chunk) {
    const node = document.createElement("div");
    node.className = "review-export-sheet single-export-sheet review-export-chunk";
    node.style.width = `${exportCanvasCssWidth()}px`;
    const stack = document.createElement("div");
    stack.className = "review-export-stack";
    stack.appendChild(chunk.cloneNode(true));
    node.appendChild(stack);
    return node;
  }

  function exportChunkNodes(exportNode) {
    const selector = [
      ".export-date-line",
      ".section-title",
      ".weekly-brief-summary",
      ".weekly-breakdown-card",
      ".monthly-table-card",
      ".review-item",
      ".weekly-key-event",
      ".weekly-reflection-card",
      ".weekly-next-card",
      ".monthly-next-card",
      ".monthly-light-item",
      ".monthly-insight-card",
      ".segment-panel",
      ".record-efficiency-band",
      ".target-category-group",
      ".habit-panel",
    ].join(",");
    const nodes = Array.from(exportNode.querySelectorAll(selector)).filter((node) => {
      if (!node.textContent.trim() && !node.querySelector(".weekly-stacked-bar, table, canvas, svg")) return false;
      return !Array.from(nodesWithSameSelectorParent(node, selector)).some((parent) => parent !== node);
    });
    if (nodes.length) return nodes;
    const stack = exportNode.querySelector(".review-export-stack") || exportNode;
    return Array.from(stack.children).filter((node) => node.textContent.trim() || node.querySelector("canvas, svg, table"));
  }

  function nodesWithSameSelectorParent(node, selector) {
    const parents = [];
    let current = node.parentElement;
    while (current) {
      if (current.matches?.(selector)) parents.push(current);
      current = current.parentElement;
    }
    return parents;
  }

  function makeManualExportCanvas(item) {
    if (item === "review-day") return makeManualDayReviewCanvas();
    if (item === "review-week") return makeManualWeekReviewCanvas();
    if (item === "review-month") return makeManualMonthReviewCanvas();
    if (item === "record-logs") return makeManualRecordLogsCanvas();
    return null;
  }

  function assertExportCanvasReadable(canvas, label = "图片") {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error(`${label}图片生成失败：没有得到有效画布。`);
    try {
      const context = canvas.getContext("2d");
      context?.getImageData(0, 0, 1, 1);
      return canvas;
    } catch (error) {
      throw new Error(`${label}图片生成失败：浏览器限制读取渲染画布，已尝试备用导出。`);
    }
  }

  function makeManualTextExportCanvas(item, exportNode) {
    const lines = exportTextLines(exportNode);
    if (!lines.length) return null;
    return makeManualCardsCanvas(exportItemName(item), exportItemMeta(item), [
      {
        heading: "内容",
        lines,
        accent: colors[0],
      },
    ]);
  }

  function exportTextLines(root) {
    const selectors = [
      "h1",
      "h2",
      "h3",
      ".entry-display-line",
      ".review-text",
      ".weekly-card-title",
      ".monthly-stats-table tr",
      ".weekly-breakdown-legend span",
      ".target-category-header",
      ".task-name",
      ".habit-name",
      ".habit-row",
      "p",
      "li",
    ].join(",");
    const seen = new Set();
    return Array.from(root.querySelectorAll(selectors))
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .filter((text) => {
        if (!text || seen.has(text)) return false;
        seen.add(text);
        return true;
      })
      .slice(0, 120);
  }

  function makeManualDayReviewCanvas() {
    const date = reviewDate("day");
    const cards = reviewItemsForExport("day", date)
      .filter(reviewItemHasContent)
      .map((item, index) => {
        const review = normalizeReviewItem(item);
        const lines = [];
        if (review.phenomenon?.trim()) lines.push(review.phenomenon.trim());
        review.reasons.forEach((reason, reasonIndex) => {
          if (reason.text?.trim()) lines.push(`原因${reasonIndex + 1}：${reason.text.trim()}`);
          if (reason.measure?.trim()) lines.push(`措施${reasonIndex + 1}：${reason.measure.trim()}`);
        });
        return { heading: `现象${index + 1}`, lines, accent: colors[index % colors.length] };
      });
    return makeManualCardsCanvas("日复盘", scopeDisplay("day", date), cards);
  }

  function makeManualWeekReviewCanvas() {
    const date = reviewDate("week");
    const review = readWeeklyReviewForKey(scopeKey("week", date));
    const dates = datesInScope("week", date);
    const study = weeklyStudySummary(date);
    const work = weeklyWorkSummary(date);
    const cards = [];
    const holidaySummary = weeklyHolidaySummaryText(date);
    if (holidaySummary) cards.push({ heading: "假期", lines: [holidaySummary], accent: "#4d8b57" });
    if (study.total || work.total) {
      cards.push({
        heading: "时间概览",
        lines: [
          `学习时长：${formatHourText(study.total)}`,
          `工位时长：${formatHourText(work.total)}`,
          `工位时间利用率：${workEfficiencyPercent(study.total, work.total)}%`,
        ],
        accent: "#39bff2",
      });
    }
    appendBreakdownManualCard(cards, "地点时间占比", locationBreakdownForDates(dates));
    appendBreakdownManualCard(cards, "学习标签占比", weeklyStudyBreakdown(date));
    const keyEvents = keyEventsForDates(dates);
    if (keyEvents.length) {
      cards.push({
        heading: "本周关键事项",
        lines: keyEvents.map((event) => `${shortDateWeekdayText(event.date)} ${event.phenomenon || ""}`),
        accent: "#8a7b35",
      });
    }
    [
      ["红灯", review.red],
      ["绿灯", review.green],
      ["总结", review.summary],
      ["下周拟改进", review.nextDirection],
    ].forEach(([heading, value], index) => {
      const lines = locationDescriptionLines(value);
      if (lines.length) cards.push({ heading, lines, accent: colors[index % colors.length] });
    });
    return makeManualCardsCanvas("周复盘", reviewNavigatorDisplay("week", date), cards);
  }

  function makeManualMonthReviewCanvas() {
    const date = reviewDate("month");
    const key = scopeKey("month", date);
    const review = normalizeMonthlyReview(state.monthlyReviews?.[key] || {});
    const dates = datesInScope("month", date);
    const cards = [];
    const holidaySummary = monthlyHolidaySummaryText(date);
    if (holidaySummary) cards.push({ heading: "假期", lines: [holidaySummary], accent: "#4d8b57" });
    appendBreakdownManualCard(cards, "地点时间占比", locationBreakdownForDates(dates));
    appendBreakdownManualCard(cards, "学习标签占比（月）", monthlyStudyBreakdown(date));
    [
      ["总结", review.summary],
      ["下月拟改进", review.nextDirection],
      ["红灯情况说明", review.redInsight],
      ["绿灯情况说明", review.greenInsight],
    ].forEach(([heading, value], index) => {
      const lines = locationDescriptionLines(value);
      if (lines.length) cards.push({ heading, lines, accent: colors[index % colors.length] });
    });
    return makeManualCardsCanvas("月复盘", scopeDisplay("month", date), cards);
  }

  function makeManualRecordLogsCanvas() {
    const logs = state.logs[dateKey()] || [];
    const cards = recordTimelineBlocks(logs, { includeDrafts: false })
      .filter((block) => block.logs.length)
      .map((block, index) => ({
        heading: block.title,
        lines: block.logs.map((log) => {
          const tag = getTag(log.tagId);
          const target = targetNameForLogLink(log.targetId, dateKey());
          return [tag?.name || "未分类", formatDuration(log.minutes), log.note || "", target ? `目标：${target}` : ""].filter(Boolean).join(" · ");
        }),
        accent: locationColor(block.type) || colors[index % colors.length],
      }));
    return makeManualCardsCanvas("今日时间记录", `${dateKey()} ${weekdayText(dateKey())}`, cards);
  }

  function appendBreakdownManualCard(cards, heading, breakdown) {
    if (!breakdown.total) return;
    cards.push({
      heading,
      lines: breakdown.entries.map((entry) => `${entry.label} ${entry.percent}%${entry.valueText ? ` · ${entry.valueText}` : ""}`),
      accent: breakdown.entries[0]?.color || colors[0],
    });
  }

  function makeManualCardsCanvas(title, meta, cards) {
    if (!cards.length) return null;
    const scale = exportScale();
    const cssWidth = exportCanvasCssWidth();
    const padding = 14;
    const cardPadding = 10;
    const gap = 10;
    const contentWidth = cssWidth - padding * 2;
    const textWidth = contentWidth - cardPadding * 2;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return null;
    const titleFont = "800 18px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
    const headingFont = "800 14px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
    const bodyFont = "650 12px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
    measure.font = bodyFont;
    const prepared = cards.map((card) => {
      const lines = card.lines.flatMap((line) => wrapCanvasText(measure, line, textWidth));
      return { ...card, wrappedLines: lines, height: cardPadding * 2 + 20 + Math.max(1, lines.length) * 18 };
    });
    const totalHeight = padding * 2 + 44 + prepared.reduce((sum, card) => sum + card.height, 0) + gap * Math.max(0, prepared.length - 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(cssWidth * scale);
    canvas.height = Math.ceil(totalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.scale(scale, scale);
    drawExportBackground(context, cssWidth, totalHeight);
    context.fillStyle = "#20231f";
    context.font = titleFont;
    context.fillText(title, padding, padding + 18);
    context.fillStyle = "#687068";
    context.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
    context.fillText(meta || "", padding, padding + 38);
    let y = padding + 50;
    prepared.forEach((card) => {
      context.fillStyle = "#ffffff";
      roundRectPath(context, padding, y, contentWidth, card.height, 8);
      context.fill();
      context.fillStyle = card.accent || colors[0];
      context.fillRect(padding, y + 10, 3, card.height - 20);
      context.fillStyle = "#20231f";
      context.font = headingFont;
      context.fillText(card.heading, padding + cardPadding, y + cardPadding + 10);
      context.fillStyle = "#40463f";
      context.font = bodyFont;
      let lineY = y + cardPadding + 32;
      (card.wrappedLines.length ? card.wrappedLines : [""]).forEach((line) => {
        context.fillText(line, padding + cardPadding, lineY);
        lineY += 18;
      });
      y += card.height + gap;
    });
    return canvas;
  }

  function wrapCanvasText(context, text, maxWidth) {
    const value = String(text || "").trim();
    if (!value) return [];
    const lines = [];
    let line = "";
    Array.from(value).forEach((char) => {
      const next = line + char;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function buildSingleExportNode(item, scope = state.activeTab) {
    const html = renderExportItem(item);
    if (!html) return null;
    const node = document.createElement("div");
    node.className = "review-export-sheet single-export-sheet";
    node.style.width = `${exportCanvasCssWidth()}px`;
    node.innerHTML = `<div class="review-export-stack">${html}</div>`;
    return node;
  }

  function exportCanvasCssWidth() {
    const viewport = Math.floor(window.innerWidth || 430);
    return clamp(Math.min(viewport - 24, 430), 320, 430);
  }

  function currentCanvasForExportItem(item) {
    const selector = {
      "record-summary": ".today-summary canvas",
      "execute-habits": ".habit-section canvas",
      "review-week": '[data-review-scope="week"] canvas',
      "review-month": '[data-review-scope="month"] canvas',
    }[item];
    return selector ? $(selector) : null;
  }

  function currentSvgForExportItem(item) {
    const selector = {
      "record-summary": ".today-summary .record-trend-chart",
    }[item];
    const node = selector ? $(selector) : null;
    return node instanceof SVGSVGElement ? node : null;
  }

  function makeChartExportCanvas(title, meta, sourceCanvas) {
    if (!(sourceCanvas instanceof HTMLCanvasElement)) return null;
    const scale = exportScale();
    const cssWidth = exportCanvasCssWidth();
    const padding = 14;
    const titleHeight = 48;
    const chartWidth = cssWidth - padding * 2;
    const ratio = sourceCanvas.width && sourceCanvas.height ? sourceCanvas.height / sourceCanvas.width : 0.62;
    const chartHeight = Math.max(180, Math.round(chartWidth * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(cssWidth * scale);
    canvas.height = Math.ceil((padding * 2 + titleHeight + chartHeight) * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图表导出画布。");
    context.scale(scale, scale);
    drawExportBackground(context, cssWidth, canvas.height / scale);
    context.fillStyle = "#ffffff";
    roundRectPath(context, padding, padding, chartWidth, titleHeight + chartHeight, 8);
    context.fill();
    context.fillStyle = "#20231f";
    context.font = "800 18px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
    context.fillText(title, padding + 12, padding + 24);
    if (meta) {
      context.fillStyle = "#687068";
      context.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
      context.fillText(meta, padding + 12, padding + 42);
    }
    context.drawImage(sourceCanvas, padding, padding + titleHeight, chartWidth, chartHeight);
    return canvas;
  }

  async function makeSvgChartExportCanvas(title, meta, sourceSvg) {
    const scale = exportScale();
    const cssWidth = exportCanvasCssWidth();
    const padding = 14;
    const titleHeight = 48;
    const chartWidth = cssWidth - padding * 2;
    const svgSize = svgElementSize(sourceSvg);
    const chartHeight = Math.max(180, Math.round(chartWidth * (svgSize.height / svgSize.width)));
    const legendItems = chartLegendItemsForExport(sourceSvg);
    const legendRows = Math.ceil(legendItems.length / 2);
    const legendHeight = legendItems.length ? legendRows * 20 + 10 : 0;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(cssWidth * scale);
    canvas.height = Math.ceil((padding * 2 + titleHeight + chartHeight + legendHeight) * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图表导出画布。");
    context.scale(scale, scale);
    drawExportBackground(context, cssWidth, canvas.height / scale);
    context.fillStyle = "#ffffff";
    roundRectPath(context, padding, padding, chartWidth, titleHeight + chartHeight + legendHeight, 8);
    context.fill();
    context.fillStyle = "#20231f";
    context.font = "800 18px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
    context.fillText(title, padding + 12, padding + 24);
    if (meta) {
      context.fillStyle = "#687068";
      context.font = "700 12px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
      context.fillText(meta, padding + 12, padding + 42);
    }
    try {
      const image = await svgElementToImage(sourceSvg);
      context.drawImage(image, padding, padding + titleHeight, chartWidth, chartHeight);
      drawChartLegendForExport(context, legendItems, padding + 12, padding + titleHeight + chartHeight + 4, chartWidth - 24);
      return canvas;
    } catch (error) {
      console.warn("SVG chart export failed.", error);
      throw new Error(`学习时间统计导出失败：${error.message || "浏览器限制 SVG 渲染"}`);
    }
  }

  function svgElementSize(svg) {
    const viewBox = svg.viewBox?.baseVal;
    if (viewBox?.width && viewBox?.height) return { width: viewBox.width, height: viewBox.height };
    const rect = svg.getBoundingClientRect();
    return { width: rect.width || 520, height: rect.height || 310 };
  }

  async function svgElementToImage(sourceSvg) {
    const size = svgElementSize(sourceSvg);
    const clone = sourceSvg.cloneNode(true);
    clone.classList.remove("water-shake");
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(size.width));
    clone.setAttribute("height", String(size.height));
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = svgChartExportCss();
    clone.insertBefore(style, clone.firstChild);
    const serialized = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
    try {
      return await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function svgChartExportCss() {
    return `
      .chart-axis{stroke:#9aa79b;stroke-width:1}
      .chart-grid{stroke:rgba(154,167,155,.28);stroke-width:1}
      .chart-axis-title,.chart-y-label,.chart-x-label,.chart-value-label,.chart-efficiency-label,.chart-expected-label{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif;font-size:13px;font-weight:780}
      .chart-axis-title,.chart-y-label,.chart-x-label,.chart-expected-label{fill:#687068}
      .chart-y-label.left{text-anchor:end}
      .chart-y-label.right{text-anchor:start}
      .chart-x-label{text-anchor:middle}
      .chart-value-layer{pointer-events:none}
      .chart-value-label{fill:#20231f;text-anchor:middle;paint-order:stroke;stroke:#fbfcfa;stroke-width:3px;stroke-linejoin:round}
      .chart-study-label{text-anchor:end}
      .chart-work-label{text-anchor:middle}
      .chart-bar-work-outline{fill:rgba(57,191,242,.07);stroke:#39bff2;stroke-width:2;vector-effect:non-scaling-stroke}
      .chart-water-layer{opacity:.72;filter:drop-shadow(0 -1px 0 rgba(255,255,255,.34))}
      .chart-ice-column{fill:rgba(198,239,253,.86);stroke:rgba(59,177,222,.72);stroke-width:1;vector-effect:non-scaling-stroke;filter:drop-shadow(0 -1px 0 rgba(255,255,255,.55))}
      .chart-expected-line{stroke-width:2;stroke-dasharray:7 6;stroke-linecap:round;opacity:.86}
      .chart-expected-label{text-anchor:end;paint-order:stroke;stroke:#fbfcfa;stroke-width:3px;stroke-linejoin:round}
      .chart-efficiency-line{fill:none;stroke:#3fa66b;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
      .chart-efficiency-dot{fill:#3fa66b;stroke:#fff;stroke-width:1.5}
      .chart-efficiency-label{fill:#2f8f5b;text-anchor:start;paint-order:stroke;stroke:#fbfcfa;stroke-width:3px;stroke-linejoin:round}
    `;
  }

  function chartLegendItemsForExport(sourceSvg) {
    const card = sourceSvg.closest(".record-trend-card");
    if (!card) return [];
    return $$(".record-trend-legend span", card).map((item) => {
      const swatch = item.querySelector("i");
      const computed = swatch ? getComputedStyle(swatch) : null;
      const background = computed?.backgroundColor || "";
      const color = background && background !== "rgba(0, 0, 0, 0)" ? background : computed?.color || "#39bff2";
      return {
        label: item.textContent.trim(),
        color,
        hollow: swatch?.classList.contains("hollow"),
        dash: swatch?.classList.contains("dash"),
        line: swatch?.classList.contains("line"),
      };
    });
  }

  function drawChartLegendForExport(context, items, x, y, width) {
    if (!items.length) return;
    const columns = width >= 330 ? 2 : 1;
    const columnWidth = width / columns;
    context.font = "700 11px system-ui, -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif";
    context.textBaseline = "middle";
    items.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const itemX = x + column * columnWidth;
      const itemY = y + row * 20 + 10;
      context.strokeStyle = item.color;
      context.fillStyle = item.color;
      context.lineWidth = 2;
      if (item.dash) {
        context.setLineDash([5, 4]);
        context.beginPath();
        context.moveTo(itemX, itemY);
        context.lineTo(itemX + 16, itemY);
        context.stroke();
        context.setLineDash([]);
      } else if (item.line) {
        context.fillRect(itemX, itemY - 1.5, 16, 3);
      } else if (item.hollow) {
        context.strokeRect(itemX, itemY - 5, 10, 10);
      } else {
        context.fillRect(itemX, itemY - 5, 10, 10);
      }
      context.fillStyle = "#687068";
      context.fillText(item.label, itemX + 22, itemY);
    });
  }

  function combineExportCanvases(canvases) {
    const visibleCanvases = canvases.filter(Boolean);
    if (!visibleCanvases.length) throw new Error("没有可合成的导出图片。");
    if (visibleCanvases.length === 1) return visibleCanvases[0];
    const gap = Math.round(14 * exportScale());
    const padding = Math.round(14 * exportScale());
    const width = Math.max(...visibleCanvases.map((canvas) => canvas.width)) + padding * 2;
    const height = visibleCanvases.reduce((sum, canvas) => sum + canvas.height, padding * 2 + gap * (visibleCanvases.length - 1));
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("无法创建长图画布。");
    context.fillStyle = "#f6f7f4";
    context.fillRect(0, 0, width, height);
    let y = padding;
    visibleCanvases.forEach((canvas) => {
      const x = Math.round((width - canvas.width) / 2);
      context.drawImage(canvas, x, y);
      y += canvas.height + gap;
    });
    return output;
  }

  function exportScale() {
    return Math.min(2, Math.max(1.5, window.devicePixelRatio || 1.5));
  }

  function drawExportBackground(context, width, height) {
    context.fillStyle = "#f6f7f4";
    context.fillRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, 0, Math.min(280, height));
    gradient.addColorStop(0, "rgba(47, 111, 115, 0.08)");
    gradient.addColorStop(1, "rgba(47, 111, 115, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, Math.min(280, height));
  }

  function roundRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function buildExportNode(items, scope = state.activeTab) {
    const previousReviewEditing = ui.reviewEditing;
    const previousTargetEditing = ui.targetEditing;
    const previousHabitEditing = ui.habitEditing;
    const previousRecordEditing = ui.recordEditing;
    const node = document.createElement("div");
    try {
      ui.reviewEditing = false;
      ui.targetEditing = false;
      ui.habitEditing = false;
      ui.recordEditing = false;
      node.className = "review-export-sheet";
      node.innerHTML = `
        <div class="review-export-stack">
          ${items.map(renderExportItem).filter(Boolean).join("")}
        </div>
      `;
    } finally {
      ui.reviewEditing = previousReviewEditing;
      ui.targetEditing = previousTargetEditing;
      ui.habitEditing = previousHabitEditing;
      ui.recordEditing = previousRecordEditing;
    }
    return node;
  }

  function renderExportItem(item) {
    const cloned = cloneExportSource(item);
    if (cloned) return cloned.outerHTML;
    if (!item.startsWith("record-")) return "";
    const renderers = {
      "record-logs": renderRecordLogsExport,
      "record-location": renderRecordLocationExport,
      "record-summary": renderRecordSummaryExport,
    };
    return renderers[item]?.() || "";
  }

  function cloneExportSource(item) {
    const app = $("#app");
    if (!app) return null;
    const fragment = document.createElement("div");
    fragment.className = `export-page-fragment export-${item}`;
    const appendClone = (node) => {
      if (!node) return;
      fragment.appendChild(cloneNodeWithRenderedCanvases(node));
    };
    const appendHtml = (html) => {
      htmlToExportNodes(html).forEach((node) => fragment.appendChild(node));
    };

    if (item === "record-logs") {
      appendClone(app.querySelector('[data-view="record"] > .section-band:first-child'));
      appendClone(app.querySelector(".record-with-axis"));
      appendClone(app.querySelector(".record-efficiency-band"));
    } else if (item === "record-location") {
      appendClone(app.querySelector(".location-panel"));
    } else if (item === "record-summary") {
      appendClone(app.querySelector(".today-summary"));
    } else if (item === "execute-targets") {
      appendClone(app.querySelector(".target-filter-band"));
      appendClone(app.querySelector(".target-section"));
    } else if (item === "execute-habits") {
      appendClone(app.querySelector(".habit-section"));
    } else if (item === "review-day") {
      appendClone(app.querySelector('[data-review-scope="day"]'));
    } else if (item === "review-week") {
      appendClone(app.querySelector('[data-review-scope="week"]'));
    } else if (item === "review-month") {
      appendClone(app.querySelector('[data-review-scope="month"]'));
    } else if (item === "review-month-red" || item === "review-month-green") {
      const previousMode = ui.monthReviewMode;
      try {
        ui.monthReviewMode = item === "review-month-green" ? "green" : "red";
        appendHtml(renderMonthlyReviewSection());
      } finally {
        ui.monthReviewMode = previousMode;
      }
    }

    if (!fragment.children.length) return null;
    cleanExportClone(fragment, item);
    return fragment.children.length ? fragment : null;
  }

  function htmlToExportNodes(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "").trim();
    return Array.from(template.content.children);
  }

  function cloneNodeWithRenderedCanvases(node) {
    const clone = node.cloneNode(true);
    const sourceCanvases = $$("canvas", node);
    const cloneCanvases = $$("canvas", clone);
    cloneCanvases.forEach((canvas, index) => {
      const source = sourceCanvases[index];
      if (!(source instanceof HTMLCanvasElement)) return;
      const image = document.createElement("img");
      image.src = source.toDataURL("image/png");
      image.width = source.clientWidth || source.width;
      image.height = source.clientHeight || source.height;
      image.alt = canvas.getAttribute("aria-label") || "";
      image.className = canvas.className;
      canvas.replaceWith(image);
    });
    return clone;
  }

  function cleanExportClone(fragment, item) {
    syncExportFormValues(fragment);
    replaceExportNavigators(fragment);
    $$(".review-due-reminder", fragment).forEach((node) => node.remove());
    $$(".location-assign-select", fragment).forEach((node) => node.remove());
    $$("[data-draft='true'], .editing-entry", fragment).forEach((node) => node.remove());
    $$(".empty", fragment).forEach((node) => node.remove());
    if (item === "record-logs") {
      $$(".segment-panel", fragment).forEach((panel) => {
        if (!panel.querySelector(".entry")) panel.remove();
      });
    }
    if (item === "record-location") {
      $$(".location-panel", fragment).forEach((panel) => {
        if (!panel.querySelector(".entry")) panel.remove();
      });
    }
    if (item === "execute-targets") {
      $$(".target-category-group", fragment).forEach((group) => {
        if (!group.querySelector(".task-group")) group.remove();
      });
    }
    $$(".review-text", fragment).forEach((node) => {
      if (/^还没有/.test(node.textContent.trim())) node.remove();
    });
    $$(".bullet-textarea", fragment).forEach((textarea) => {
      if (!textarea.value.trim()) textarea.closest(".form-row, .monthly-next-card, .monthly-insight-card")?.remove();
    });
    $$(".weekly-reflection-card, .weekly-next-card, .monthly-next-card, .monthly-light-item, .monthly-insight-card, .review-item, .monthly-key-event, .monthly-key-card, .weekly-breakdown-card, .monthly-table-card", fragment).forEach((node) => {
      if (node.querySelector("textarea, .review-text, .monthly-stats-table, .weekly-stacked-bar, .entry, .task-group, .habit-panel, .monthly-light-item, .monthly-key-event")) return;
      node.remove();
    });
  }

  function replaceExportNavigators(fragment) {
    $$(".date-switch-panel", fragment).forEach((panel) => {
      const value = panel.querySelector(".date-display-field")?.textContent?.trim();
      if (!value) {
        panel.remove();
        return;
      }
      const line = document.createElement("p");
      line.className = "export-date-line";
      line.textContent = value;
      panel.replaceWith(line);
    });
  }

  function syncExportFormValues(root) {
    $$("textarea", root).forEach((textarea) => {
      textarea.textContent = textarea.value || "";
      textarea.setAttribute("placeholder", "");
    });
    $$("input", root).forEach((input) => {
      if (input.type === "checkbox" || input.type === "radio") {
        if (input.checked) input.setAttribute("checked", "");
        else input.removeAttribute("checked");
        return;
      }
      input.setAttribute("value", input.value || "");
    });
    $$("select", root).forEach((select) => {
      Array.from(select.options).forEach((option) => {
        if (option.selected) option.setAttribute("selected", "");
        else option.removeAttribute("selected");
      });
    });
  }

  function renderRecordLogsExport() {
    const logs = state.logs[dateKey()] || [];
    const blocks = recordTimelineBlocks(logs, { includeDrafts: false }).filter((block) => block.logs.length);
    if (!blocks.length) return "";
    return `
      <section class="section-band export-block">
        <div class="section-title"><div><div class="title-with-date"><h2>今日时间追踪</h2><span>${dateKey()} ${weekdayText(dateKey())}</span></div></div></div>
        ${renderRecordTimeline(logs, { includeDrafts: false, requireLogs: true })}
      </section>
    `;
  }

  function renderSegmentExport(segment, logs) {
    const segmentLogs = logs.filter((entry) => entry.segmentId === segment.id);
    return `
      <section class="segment-panel" data-segment="${segment.id}">
        <div class="segment-header">
          <div class="segment-title-line">
            <h2>${escapeHtml(segment.name)}</h2>
            <span class="segment-time">${segment.start} - ${segment.end}</span>
          </div>
        </div>
        <div class="entries">
          ${segmentLogs.map((entry) => renderLogEntry(entry, false)).join("")}
        </div>
      </section>
    `;
  }

  function renderRecordLocationExport() {
    if (!hasExportData("record-location")) return "";
    return renderLocationPanel(locationRecordsForDate(), { includeDrafts: false });
  }

  function renderRecordSummaryExport() {
    if (!hasExportData("record-summary")) return "";
    return renderRecordSummaries();
  }

  function renderTargetsExport() {
    const targets = targetsForCurrentScope();
    if (!targets.length) return "";
    const tags = targetTagList(targets).filter((tag) => targets.some((target) => targetTag(target) === tag));
    return `
      <section class="section-band export-block">
        <div class="section-title"><div><h2>目标</h2><p class="hint">${scopeDisplay("day", dateKey())}</p></div></div>
        <div class="task-stack">
          ${tags.map((tag) => renderTargetGroupExport(tag, targets.filter((target) => targetTag(target) === tag))).join("")}
        </div>
      </section>
    `;
  }

  function renderTargetGroupExport(tag, targets) {
    const sorted = targets.sort((a, b) => Number(isTaskDone(a)) - Number(isTaskDone(b)));
    return `
      <section class="target-category-group" data-target-tag="${escapeAttr(tag)}">
        <div class="target-category-header"><span>${escapeHtml(tag)}（${sorted.length}）</span></div>
        <div class="target-category-list">${sorted.map((target) => renderTarget(target)).join("")}</div>
      </section>
    `;
  }

  function renderHabitsExport() {
    if (!state.habits.length) return "";
    return `
      <section class="section-band export-block">
        <div class="section-title"><div><h2>习惯追踪</h2><p class="hint">${habitTrailRangeText()}</p></div></div>
        <div class="habit-stack">
          ${state.habits.map(renderHabit).join("")}
        </div>
      </section>
    `;
  }

  function renderWeekReviewExport() {
    const date = reviewDate("week");
    const key = scopeKey("week", date);
    const review = readWeeklyReviewForKey(key);
    const breakdown = weeklyStudyBreakdown(date);
    return `
      <section class="section-band review-scope-section weekly-review-section export-block" data-review-scope="week">
        ${renderReviewNavigator("week")}
        <div class="section-title"><div><h2>周复盘</h2><p class="hint">${scopeDisplay("week", date)}</p></div></div>
        ${renderWeeklyReviewSummary(date, { omitEmpty: true })}
        ${renderLocationBreakdownCard(locationBreakdownForDates(datesInScope("week", date)), "地点时间占比", "")}
        ${breakdown.total ? renderStudyBreakdownCard(breakdown, "学习标签占比", "") : ""}
        ${renderWeeklyReviewStatic(review)}
      </section>
    `;
  }

  function renderDayReviewExport() {
    const scope = "day";
    const date = reviewDate(scope);
    const reviewItems = reviewItemsForExport(scope, date).filter(reviewItemHasContent);
    if (!reviewItems.length) return "";
    return `
      <section class="section-band review-scope-section export-block" data-review-scope="${scope}">
        ${renderReviewNavigator(scope)}
        <div class="section-title">
          <div>
            <h2>${reviewLabel(scope)}</h2>
            <p class="hint">${scopeDisplay(scope, date)}</p>
          </div>
        </div>
        <div class="review-stack">
          ${reviewItems.map((item, index) => renderReviewItemExport(item, index, scope)).join("")}
        </div>
        ${renderReviewDueReminder(date)}
      </section>
    `;
  }

  function renderReviewItemExport(item, index, scope = "day") {
    const review = normalizeReviewItem(item);
    const reasons = review.reasons.filter((reason) => reason.text?.trim() || reason.measure?.trim());
    return `
      <article class="review-item compact-review-item" data-review-id="${review.id}" data-review-scope="${scope}">
        <div class="entry-display-line">
          <span class="review-label phenomenon-label"><i></i><strong>现象${index + 1}</strong></span>
          ${renderReviewStarControl(review, scope)}
        </div>
        ${review.phenomenon?.trim() ? `<p class="review-text">${escapeMultiline(review.phenomenon)}</p>` : ""}
        ${reasons.length ? `<div class="review-reason-list">${reasons.map((reason, reasonIndex) => renderReasonDisplayExport(reason, reasonIndex)).join("")}</div>` : ""}
      </article>
    `;
  }

  function renderReasonDisplayExport(reason, index) {
    return `
      <div class="review-reason">
        <div class="entry-display-line muted-line"><span class="review-label reason-label"><i></i><strong>原因${index + 1}</strong></span></div>
        ${reason.text?.trim() ? `<p class="review-text">${escapeMultiline(reason.text)}</p>` : ""}
        ${reason.measure?.trim() ? `<div class="entry-display-line muted-line"><span class="review-label measure-label"><i></i><strong>措施</strong></span></div><p class="review-text">${escapeMultiline(reason.measure)}</p>` : ""}
      </div>
    `;
  }

  function renderWeeklyReviewStatic(review) {
    const reflectionCards = [
      review.red?.trim() ? renderWeeklyReflectionCard("red", "红灯", "本周感到挫败和消耗能量的事", review.red) : "",
      review.green?.trim() ? renderWeeklyReflectionCard("green", "绿灯", "本周最有成就感/最顺利的事", review.green) : "",
    ].join("");
    return `
      ${reflectionCards ? `<h3 class="weekly-section-heading">红绿灯自评</h3><div class="weekly-reflection-grid">${reflectionCards}</div>` : ""}
      ${review.summary?.trim() ? `<section class="weekly-next-card">
        <div class="weekly-card-title"><i class="weekly-icon amber"></i><strong>总结</strong></div>
        <p class="review-text">${escapeMultiline(review.summary)}</p>
      </section>` : ""}
      ${review.nextDirection?.trim() ? `<section class="weekly-next-card">
        <div class="weekly-card-title"><i class="weekly-icon blue"></i><strong>下周拟改进</strong></div>
        <p class="review-text">${escapeMultiline(review.nextDirection)}</p>
      </section>` : ""}
    `;
  }

  function renderMonthReviewExport() {
    const date = reviewDate("month");
    const key = scopeKey("month", date);
    const review = monthlyReviewForKey(key);
    const breakdown = monthlyStudyBreakdown(date);
    return `
      <section class="section-band review-scope-section monthly-review-section export-block" data-review-scope="month">
        ${renderReviewNavigator("month")}
        <div class="section-title"><div><h2>月复盘</h2><p class="hint">${scopeDisplay("month", date)}</p></div></div>
        ${monthlyStatsHasData(date) ? renderMonthlyStatsTable(date, { omitEmptyRows: true }) : ""}
        ${renderLocationBreakdownCard(locationBreakdownForDates(datesInScope("month", date)), "地点时间占比", "")}
        ${breakdown.total ? renderStudyBreakdownCard(breakdown, "学习标签占比（月）", "") : ""}
        ${monthlyWeeklySummaryHasData(date) ? renderMonthlyWeeklySummaryList(date, { omitEmpty: true }) : ""}
        ${review.summary?.trim() ? `<section class="monthly-next-card">
          <div class="weekly-card-title"><i class="weekly-icon amber"></i><strong>总结</strong></div>
          <p class="review-text">${escapeMultiline(review.summary)}</p>
        </section>` : ""}
        ${review.nextDirection?.trim() ? `<section class="monthly-next-card">
          <div class="weekly-card-title"><i class="weekly-icon blue"></i><strong>下月拟改进</strong></div>
          <p class="review-text">${escapeMultiline(review.nextDirection)}</p>
        </section>` : ""}
      </section>
    `;
  }

  function renderMonthLightExport(mode) {
    const date = reviewDate("month");
    const key = scopeKey("month", date);
    const review = monthlyReviewForKey(key);
    const title = mode === "red" ? "红灯情况说明" : "绿灯情况说明";
    const description =
      mode === "red"
        ? "红灯指向的是同一个事件还是多个？有没有进行针对性调整？本月核心瓶颈是什么？"
        : "这些做得好的事情有什么共同原因吗？有没有什么可复用的地方？";
    const value = mode === "red" ? review.redInsight : review.greenInsight;
    const lightList = renderMonthlyLightList(mode, date, { omitEmpty: true });
    return `
      <section class="section-band export-block monthly-review-section">
        <div class="section-title"><div><h2>${title}</h2><p class="hint">${scopeDisplay("month", date)}</p></div></div>
        ${lightList}
        ${value?.trim() ? `<section class="monthly-insight-card ${mode}">
          <div class="weekly-card-title"><i class="weekly-icon ${mode}"></i><strong>${title}</strong><span>${description}</span></div>
          <p class="review-text">${escapeMultiline(value)}</p>
        </section>` : ""}
      </section>
    `;
  }

  async function renderNodeToCanvas(node, width, height) {
    const cssText = collectExportCss();
    const serializedNode = new XMLSerializer().serializeToString(node);
    const html = `
      <div xmlns="http://www.w3.org/1999/xhtml">
        <style><![CDATA[${cssText.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></style>
        ${serializedNode}
      </div>
    `;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <foreignObject width="100%" height="100%">${html}</foreignObject>
      </svg>
    `;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = await loadImage(url);
      const scale = exportScale();
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法创建导出画布。");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      return canvas;
    } catch (error) {
      console.warn("PNG export failed.", error);
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function renderNodeToPng(node, width, height) {
    const canvas = await renderNodeToCanvas(node, width, height);
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png")) throw new Error("导出 PNG 生成失败。");
    return dataUrl;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片生成失败：浏览器没有返回 PNG 数据。"));
      }, "image/png");
    });
  }

  async function copyCanvasImage(canvas) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("当前浏览器不支持复制图片，请使用保存图片或长按预览图保存。");
    }
    const blob = await canvasToBlob(canvas);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }

  async function saveCanvasImage(canvas, filename = "导出图片.png") {
    const blob = await canvasToBlob(canvas);
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (error) {
        if (error?.name === "AbortError") throw new Error("已取消保存/分享。");
        console.warn("navigator.share failed, fallback to download.", error);
      }
    }
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function sameExportItems(a = [], b = []) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }

  function sanitizeFilename(value) {
    return String(value || "导出图片").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48) || "导出图片";
  }

  function collectExportCss() {
    const cssText = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules || []).map((rule) => rule.cssText).join("\n");
        } catch (error) {
          return "";
        }
      })
      .join("\n");
    return `
      ${cssText}
      .review-export-sheet {
        width: 430px;
        min-height: 100%;
        padding: 14px;
        background:
          linear-gradient(180deg, rgba(47, 111, 115, 0.08), transparent 280px),
          var(--bg);
        color: var(--ink);
      }
      .review-export-header {
        display: grid;
        gap: 3px;
        margin-bottom: 10px;
      }
      .review-export-header h2 {
        margin: 0;
        color: var(--ink);
        font-size: 20px;
      }
      .review-export-header p {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
      }
      .review-export-stack {
        display: grid;
        gap: 12px;
      }
      .review-export-sheet .hint,
      .review-export-sheet .empty,
      .review-export-sheet .weekly-card-title span,
      .review-export-sheet .review-due-reminder {
        display: none !important;
      }
      .review-export-sheet .button-row,
      .review-export-sheet .icon-button,
      .review-export-sheet .secondary-button,
      .review-export-sheet .primary-button,
      .review-export-sheet .ghost-button,
      .review-export-sheet .danger-button,
      .review-export-sheet .move-button,
      .review-export-sheet .stepper-button,
      .review-export-sheet .toggle-button,
      .review-export-sheet .date-arrow,
      .review-export-sheet .date-calendar-button,
      .review-export-sheet .axis-add-time,
      .review-export-sheet .location-assign-select {
        display: none !important;
      }
      .review-export-sheet .date-switch-panel {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .review-export-sheet .record-with-axis {
        min-height: auto;
      }
      .review-export-sheet .export-page-fragment {
        display: grid;
        gap: 12px;
      }
      .review-export-sheet .record-efficiency-band {
        padding: 10px 12px;
      }
      .review-export-sheet .efficiency-strip strong {
        margin-left: auto;
      }
      .review-export-sheet .export-date-line {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        font-weight: 800;
      }
    `;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
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
      "v1.7": {
        updatedAt: "2026-07-07",
        items: [
          "记录页时间逻辑改为左侧全天地点时间轴，支持空心未计入时段、添加地点时间、默认地点和地点颜色维护。",
          "地点记录框简化为空状态只显示地点名称和操作入口，支持地点描述、小圆点文本、事项记录和连续同地点时段合并。",
          "新增假期时间与期望学习/工位时长设置；假期不计算工位时长利用率，周复盘和月复盘会汇总显示假期信息。",
          "学习时间统计替代近七日汇总，图表支持左右滑动切换 7 日时间窗口，数值标签置顶并加背景描边，导出时同步使用当前窗口和当前勾选显示状态。",
          "新增地点时间占比统计，记录页、周复盘和月复盘都会按当前地点顺序展示地点占比；未分配地点事项可手动归属到现有地点段。",
          "学习时间统计图改为水杯样式：工位时长为空心水蓝柱，学习时长为水色填充，滚动、刷新和滑动图表会触发杯内水面晃动。",
          "学习填满工位或只有学习无工位时，学习柱显示为固定冰块状态；工位时间利用率改为绿色折线，非假期无工位按 0 连线、假期跳过。",
          "导出图片重做为渲染级长图导出，提供预览、复制图片和保存图片；学习时间统计使用当前已渲染 SVG 直绘，避免纯文字导出。",
          "优化移动端统计图、期望时长、假期时间和记录页标题布局，减少拥挤与重复标题。",
        ],
      },
      "v1.6": {
        updatedAt: "2026-07-01",
        items: [
          "记录页支持把时间追踪记录关联到目标，目标卡片会汇总显示对应记录时长，并兼容目标迁移后的持续统计。",
          "同步自网站1的宿舍时间会显示在地点时间列表中，并可在本网站内编辑；编辑后会覆盖原同步段，避免重复展示和重复统计。",
          "记录页底部新增学习时长、工位时长和学习/工位效率百分比。",
          "目标标签栏和目标分组显示任务数量，目标编辑时标签改为常驻下拉选择，默认显示默认标签且可随时改为其他标签。",
          "周复盘和月复盘改为常驻可填写文本框，新增总结栏；月复盘总结页显示当月各周总结情况。",
          "多行文字框支持自动增高；周/月复盘文字框换行后会立即显示待输入小圆点，失焦或保存时自动清理空白行，文本框内不再显示默认描述。",
          "导出图片入口按记录、执行、复盘拆分；预览改为克隆当前页面结构，尽量达到截图级效果，空内容会灰掉不可勾选，导出图会自动过滤空卡片和说明文字。",
          "导出入口回到顶部备份键左侧，并按当前页签自动导出对应内容；导出图中日期切换栏改为纯日期文字，复盘提醒不会进入导出图。",
          "记录页效率条移动到今日汇总上方并随时间追踪一起导出；文案统一为工位时间利用率，周复盘和月复盘同步显示该指标。",
          "记录页汇总图从扇形图改为近7日柱状/折线组合图，可勾选显示工位时长、学习时长和工位时间利用率。",
          "目标记录时长改为按目标迁移链路全局统计到当前日期，补关联历史记录后会计入当前目标总时长。",
          "优化习惯 100% 完成标记，改为更清晰的实心花形图标。",
        ],
      },
      "v1.5": {
        updatedAt: "2026-06-29",
        items: [
          "接入同一用户在 daily_record_sync 中的睡眠记录，睡眠时长可自动合并进记录汇总，并兼容手动修正的总睡眠时长。",
          "睡眠跨天时按午夜拆分到前后两天；上床到起床区间默认计为宿舍地点时间，并参与地点时间轴和地点汇总。",
          "复盘页改为日、周、月顶部页签切换，各复盘保留独立时间；周复盘切换栏隐藏年份，只显示月日范围。",
          "日复盘现象支持标记关键事件；周复盘新增本周关键事件，默认显示日期和现象，点按后展开原因和措施。",
          "周复盘新增学习时长、工位时长、学习标签占比、红绿灯自评和下周拟改进，并优化区块间距。",
          "月复盘新增按周统计表、月度学习标签占比、红/绿灯逐周展开和月度总结；跨月周按月初所在周归属，避免重复复盘。",
          "周/月复盘的拟改进区域统一只填写方向，月复盘统计表格统一使用 h 作为小时单位。",
          "优化月复盘红绿灯/总结入口的视觉状态，未选中时也保留对应颜色的实心圆点。",
          "日复盘会在周日提醒进行周复盘，在每月最后一天提醒进行月复盘。",
        ],
      },
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
      const detail = await readableRemoteError(response, SUPABASE_TABLE);
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
    await refreshExternalSleepData();
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
    if (!response.ok) throw new Error(await readableRemoteError(response, SUPABASE_TABLE));
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
      await refreshExternalSleepData();
      syncMeta.message = "已自动合并并同步";
      return;
    }
    await saveRemoteNow();
    await refreshExternalSleepData();
    syncMeta.message = "云端已创建自动备份";
  }

  async function refreshExternalSleepData() {
    try {
      externalSleepData = await fetchSleepSourceData();
    } catch (error) {
      console.warn("读取睡眠数据失败", error);
      externalSleepData = null;
    }
  }

  async function fetchSleepSourceData() {
    await ensureFreshSession();
    if (!session.user?.id) return null;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${SLEEP_SOURCE_TABLE}?user_id=eq.${encodeURIComponent(session.user.id)}&select=data,updated_at&limit=1`, {
      headers: supabaseHeaders(),
    });
    if (!response.ok) throw new Error(await readableRemoteError(response, SLEEP_SOURCE_TABLE));
    const rows = await response.json();
    return rows.length ? rows[0].data || null : null;
  }

  async function readableRemoteError(response, tableName = SUPABASE_TABLE) {
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      const detail = [data.message || data.msg, data.details, data.hint, data.code ? `代码 ${data.code}` : "", `HTTP ${response.status}`]
        .filter(Boolean)
        .join("；");
      return explainRemoteError(detail || text || `云端操作失败 HTTP ${response.status}`, tableName);
    } catch (error) {
      return explainRemoteError(text || `云端操作失败 HTTP ${response.status}`, tableName);
    }
  }

  function explainRemoteError(message, tableName = SUPABASE_TABLE) {
    if (/payload does not exist|42703/i.test(message)) {
      return `${message}。需要检查 Supabase 的 ${tableName} 表字段是否和前端同步代码一致。`;
    }
    if (/permission|rls|row-level|42501/i.test(message)) {
      return `${message}。需要检查 ${tableName} 的 RLS 策略是否允许当前用户 select/insert/update 自己的数据。`;
    }
    if (/on_conflict|unique|constraint|42P10/i.test(message)) {
      return `${message}。需要让 ${tableName}.id 成为 primary key 或 unique，或调整前端 on_conflict。`;
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
    openModal(
      "地点",
      `
        <p class="hint">默认地点会用于左侧时间轴新添加的时间段；当前默认是户外黄色。</p>
        <div class="location-type-editor" data-location-type-list>
          ${locationTypes().map((location) => renderLocationTypeRow(location, location.id === defaultLocationId())).join("")}
        </div>
        <div class="button-row">
          <button class="secondary-button" type="button" data-modal-action="add-location-type">新增地点</button>
          <button class="primary-button" type="button" data-modal-action="save-locations">保存</button>
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", (event) => {
          const action = event.target.dataset.modalAction;
          if (action === "add-location-type") {
            const list = $("[data-location-type-list]", backdrop);
            list.insertAdjacentHTML("beforeend", renderLocationTypeRow({ id: uid(), name: "新地点", color: colors[list.children.length % colors.length] }, false));
            return;
          }
          if (action === "delete-location-type") {
            const rows = $$("[data-location-type-row]", backdrop);
            const row = event.target.closest("[data-location-type-row]");
            if (rows.length <= 1 || row?.querySelector("[data-location-default]")?.checked) return;
            row?.remove();
            return;
          }
          if (action !== "save-locations") return;
          const next = collectLocationTypes(backdrop);
          setState((draft) => {
            draft.settings.locationTypes = next.types;
            draft.settings.defaultLocationId = next.defaultLocationId;
          });
          closeModal();
        });
      },
    );
  }

  function renderLocationTypeRow(location, isDefault = false) {
    return `
      <div class="location-type-row" data-location-type-row data-location-id="${escapeAttr(location.id)}">
        <label class="form-row"><span class="field-label">地点</span><input data-location-type-field="name" value="${escapeAttr(location.name)}" /></label>
        <label class="form-row compact-color-row"><span class="field-label">颜色</span><input type="color" data-location-type-field="color" value="${escapeAttr(location.color)}" /></label>
        <label class="default-location-choice">
          <input class="checkbox" type="radio" name="default-location" data-location-default ${isDefault ? "checked" : ""} />
          <span>默认</span>
        </label>
        <button class="danger-button" type="button" data-modal-action="delete-location-type">删除</button>
      </div>
    `;
  }

  function collectLocationTypes(backdrop) {
    const seen = new Set();
    const types = [];
    let defaultLocationIdValue = "";
    $$("[data-location-type-row]", backdrop).forEach((row, index) => {
      const id = normalizeLocationTypeId(row.dataset.locationId) || uid();
      if (seen.has(id)) return;
      seen.add(id);
      const name = $("[data-location-type-field='name']", row).value.trim() || "地点";
      const color = normalizeColor($("[data-location-type-field='color']", row).value, colors[index % colors.length]);
      types.push({ id, name, color });
      if ($("[data-location-default]", row).checked) defaultLocationIdValue = id;
    });
    const normalized = normalizeLocationTypes(types);
    return {
      types: normalized,
      defaultLocationId: normalizeLocationId(defaultLocationIdValue, normalized),
    };
  }

  function openLocationTimeModal(seed = null) {
    const draft = { ...defaultLocationTimeDraft(), ...(seed || {}) };
    const existing = draft.id ? locationEntriesForDate().find((entry) => entry.id === draft.id) : null;
    const locationId = draft.id || uid();
    const locationIds = draft.ids?.length ? draft.ids : [locationId];
    const isSynced = Boolean(existing?.synced || existing?.source === "sleep");
    openModal(
      existing ? "编辑地点时间" : "添加地点时间",
      `
        <div class="location-time-editor" data-location-time-id="${escapeAttr(locationId)}">
          <label class="form-row">
            <span class="field-label">地点</span>
            <select data-location-time-field="type">${renderLocationTypeOptions(draft.type)}</select>
          </label>
          <div class="grid-2 tight-grid">
            <label class="form-row"><span class="field-label">开始</span><input type="time" data-location-time-field="start" value="${escapeAttr(draft.start || "")}" /></label>
            <label class="form-row"><span class="field-label">结束</span><input type="time" data-location-time-field="end" value="${escapeAttr(draft.end || "")}" /></label>
          </div>
        </div>
        <div class="log-edit-buttons">
          <button class="secondary-button" type="button" data-modal-action="save-location-time">保存</button>
          ${existing && !isSynced ? `<button class="danger-button" type="button" data-modal-action="delete-location-time">删除</button>` : ""}
        </div>
      `,
      (backdrop) => {
        backdrop.addEventListener("click", (event) => {
          const action = event.target.dataset.modalAction;
          if (action === "delete-location-time") {
            confirmDelete("确认要删除这段地点时间吗？", () => {
              setState((stateDraft) => {
                persistLocationEntry(stateDraft, { id: locationId, ids: locationIds, type: "", start: "", end: "", date: dateKey() });
              });
              closeModal();
            });
            return;
          }
          if (action !== "save-location-time") return;
          const type = $("[data-location-time-field='type']", backdrop).value;
          const start = $("[data-location-time-field='start']", backdrop).value;
          const end = $("[data-location-time-field='end']", backdrop).value;
          if (!type || !start || (end && start === end && !isFullDayLocationRecord({ start, end }))) {
            alert("请选择地点，并填写有效的开始时间。");
            return;
          }
          setState((stateDraft) => {
            persistLocationEntry(stateDraft, { id: locationId, ids: locationIds, type, start, end, date: dateKey() });
          });
          closeModal();
        });
      },
    );
  }

  function renderLocationTypeOptions(selectedType = defaultLocationId()) {
    return locationTypes()
      .map((location) => `<option value="${escapeAttr(location.id)}" ${location.id === selectedType ? "selected" : ""}>${escapeHtml(location.name)}</option>`)
      .join("");
  }

  function locationDraftFromAxis(actionNode) {
    const ids = parseIdList(actionNode.dataset.locationIds || actionNode.dataset.locationId);
    const locationId = ids[0] || "";
    const existing = locationId ? locationEntriesForDate().find((entry) => entry.id === locationId) : null;
    return {
      id: existing?.id || "",
      ids,
      type: existing?.type || actionNode.dataset.locationType || defaultLocationId(),
      start: existing?.start || actionNode.dataset.axisStart || "",
      end: existing?.end || actionNode.dataset.axisEnd || "",
      source: existing?.source || "",
      synced: Boolean(existing?.synced),
    };
  }

  function locationDraftFromBlock(blockNode) {
    const ids = parseIdList(blockNode.dataset.locationIds || blockNode.dataset.locationBlock);
    return {
      id: ids[0] || "",
      ids,
      type: blockNode.dataset.locationType || defaultLocationId(),
      start: blockNode.dataset.locationStart || "",
      end: blockNode.dataset.locationRawEnd ?? blockNode.dataset.locationEnd ?? "",
    };
  }

  function openLocationSliceInfo(actionNode) {
    const type = actionNode.dataset.locationType || "";
    const start = actionNode.dataset.axisStart || "";
    const end = actionNode.dataset.axisEnd || "";
    openModal(
      locationLabel(type),
      `
        <div class="location-slice-info" style="--location-color:${locationColor(type)};--location-bg:${locationSoftColor(type, 0.14)}">
          <i class="color-dot location-dot" style="background:${locationColor(type)}"></i>
          <strong>${escapeHtml(locationLabel(type))}</strong>
          <span>${escapeHtml(start)} - ${escapeHtml(end)}</span>
        </div>
      `,
    );
  }

  function parseIdList(value = "") {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function defaultLocationTimeDraft() {
    const range = recordAxisRange();
    const rangeStart = minutesToTime(range.start);
    let start = nextLocationStartTime() || rangeStart;
    return {
      id: "",
      type: defaultLocationId(),
      start,
      end: "",
    };
  }

  function nextLocationStartTime(date = dateKey()) {
    const entries = locationEntriesForDate(date).filter((entry) => entry.start && entry.end);
    if (!entries.length) return "";
    const lastEntry = [...entries].sort((a, b) => absoluteEndMinute(a) - absoluteEndMinute(b)).at(-1);
    return lastEntry?.end || "";
  }

  function absoluteEndMinute(entry) {
    const start = timeToMinutes(entry.start);
    const end = timeToMinutes(entry.end);
    if (isFullDayLocationRecord(entry)) return 1440;
    return end <= start ? end + 1440 : end;
  }

  function currentClockMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function roundToFiveMinutes(minutes) {
    return Math.min(1435, Math.max(0, Math.round(minutes / 5) * 5));
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
    const targetTagValue = existingTarget ? targetTag(existingTarget) : defaultTargetTag();
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
            </div>
            <label class="target-tag-editor show-target-tag">
              <span class="field-label">目标标签</span>
              <select id="target-tag">
                ${targetTagList(targetsForCurrentScope()).map((tag) => `<option value="${escapeAttr(tag)}" ${tag === targetTagValue ? "selected" : ""}>${escapeHtml(tag)}</option>`).join("")}
              </select>
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
    const fallbackTag = existingTarget ? targetTag(existingTarget) : defaultTargetTag();
    return {
      id: existingTarget?.id || uid(),
      name: $("#target-name", backdrop).value.trim() || "未命名目标",
      tag: rawTag || fallbackTag,
      description: $("#target-description", backdrop).value.trim(),
      hasProgress: $("#target-progress", backdrop).checked,
      total,
      done: Math.min(existingTarget?.done || 0, total),
      completedAt: existingTarget?.completedAt || "",
      startedAt: existingTarget?.startedAt || dateKey(),
      collapsed: existingTarget?.collapsed ?? true,
      originTargetId: existingTarget ? targetLinkId(existingTarget) : "",
      migration: existingTarget?.migration ? { ...existingTarget.migration } : undefined,
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
    if (action === "toggle-record-chart-series") return toggleRecordChartSeries(actionNode.dataset.series, actionNode.checked);
    if (action === "toggle-record-edit") return toggleEditMode("recordEditing");
    if (action === "toggle-target-edit") return toggleEditMode("targetEditing");
    if (action === "toggle-habit-edit") return toggleEditMode("habitEditing");
    if (action === "toggle-review-edit") return toggleEditMode("reviewEditing");
    if (action === "edit-segments" || action === "edit-locations") return openLocationsModal();
    if (action === "edit-tags") return openTagsModal();
    if (action === "add-location-time") return openLocationTimeModal();
    if (action === "set-location-slice") return openLocationSliceInfo(actionNode);
    if (action === "edit-location-time") return openLocationTimeModal(locationDraftFromBlock(actionNode.closest("[data-location-block]")));
    if (action === "toggle-location-description") return toggleLocationDescription(actionNode);
    if (action === "add-holiday") return addHolidayRange();
    if (action === "edit-holidays") return toggleHolidayEditing();
    if (action === "save-holidays") return saveHolidayEditing();
    if (action === "delete-holiday") return deleteHolidayRange(actionNode.closest("[data-holiday-id]").dataset.holidayId);
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
    if (action === "open-export") return openExportModal(actionNode.dataset.exportScope);
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
    if (event.target instanceof HTMLTextAreaElement) autoResizeTextarea(event.target);
    const actionNode = event.target.closest("[data-action]");
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    if (action === "update-log") updateLog(actionNode.closest("[data-log-id]").dataset.logId, actionNode.dataset.field, actionNode.value, false);
    if (action === "update-location") updateLocationDraft(actionNode.closest("[data-location-id]").dataset.locationId, actionNode.dataset.field, actionNode.value, false);
    if (action === "update-location-description") updateLocationDescriptionDraft(actionNode, actionNode.value);
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
    if (actionNode.dataset.action === "update-location-description") {
      saveLocationDescriptionFromNode(actionNode, { render: false });
    }
    if (actionNode.dataset.action === "update-holiday") {
      updateHolidayRange(actionNode.closest("[data-holiday-id]").dataset.holidayId, actionNode.dataset.field, actionNode.value);
    }
    if (actionNode.dataset.action === "update-expected-hours") {
      updateExpectedHours(actionNode.dataset.field, actionNode.value);
    }
    if (actionNode.dataset.action === "toggle-expected-line") {
      toggleExpectedLine(actionNode.dataset.field, actionNode.checked);
    }
    if (actionNode.dataset.action === "assign-location-block") {
      assignLocationBlockLogs(actionNode);
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

  document.addEventListener("paste", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.classList.contains("bullet-textarea")) return;
    window.setTimeout(() => sanitizeBulletTextarea(event.target, { removeEmptyLines: false, dispatch: true }), 0);
  });

  let waterMotionTimer = null;
  let waterMotionFrame = null;
  function triggerChartWaterMotion() {
    const charts = $$(".record-trend-chart");
    if (!charts.length) return;
    if (waterMotionFrame) window.cancelAnimationFrame(waterMotionFrame);
    charts.forEach((chart) => chart.classList.remove("water-shake"));
    charts[0].getBoundingClientRect();
    waterMotionFrame = window.requestAnimationFrame(() => {
      charts.forEach((chart) => chart.classList.add("water-shake"));
      window.clearTimeout(waterMotionTimer);
      waterMotionTimer = window.setTimeout(() => {
        charts.forEach((chart) => chart.classList.remove("water-shake"));
        waterMotionFrame = null;
      }, 1350);
    });
  }

  document.addEventListener(
    "scroll",
    () => {
      triggerChartWaterMotion();
    },
    { passive: true },
  );

  document.addEventListener(
    "focus",
    (event) => {
      if (event.target instanceof HTMLTextAreaElement && event.target.classList.contains("bullet-textarea")) {
        updateBulletTextareaMarkers(event.target);
      }
    },
    true,
  );

  document.addEventListener(
    "blur",
    (event) => {
      if (event.target instanceof HTMLTextAreaElement) {
        if (event.target.classList.contains("bullet-textarea")) sanitizeBulletTextarea(event.target, { removeEmptyLines: true, dispatch: true });
        if (event.target.dataset.action === "update-location-description") saveLocationDescriptionFromNode(event.target, { render: false });
        autoResizeTextarea(event.target);
      }
    },
    true,
  );

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
      type: defaultLocationId(),
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
    if (!draft.type || !draft.start || (draft.end && draft.start === draft.end && !isFullDayLocationRecord(draft))) {
      alert("请先选择地点，并填写有效的开始时间。");
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
      targetId: "",
      note: "",
    });
    render();
  }

  function toggleLocationDescription(actionNode) {
    const blockNode = actionNode.closest("[data-location-block]");
    if (!blockNode) return;
    const ids = parseIdList(blockNode.dataset.locationIds || blockNode.dataset.locationBlock);
    const noteKey = blockNode.dataset.locationNoteKey || locationAxisKey(ids);
    if (ui.editingLocationDescriptions.has(noteKey)) {
      const textarea = $("[data-action='update-location-description']", blockNode);
      saveLocationDescriptionValue(noteKey, ids, textarea?.value ?? ui.locationDescriptionDrafts.get(noteKey) ?? "");
      ui.editingLocationDescriptions.delete(noteKey);
      ui.locationDescriptionDrafts.delete(noteKey);
    } else {
      ui.locationDescriptionDrafts.set(noteKey, locationDescriptionForIds(ids));
      ui.editingLocationDescriptions.add(noteKey);
    }
    render();
  }

  function updateLocationDescriptionDraft(actionNode, value) {
    const noteKey = actionNode.dataset.locationNoteKey || actionNode.closest("[data-location-note-key]")?.dataset.locationNoteKey;
    if (!noteKey) return;
    ui.locationDescriptionDrafts.set(noteKey, value);
  }

  function saveLocationDescriptionFromNode(actionNode, options = {}) {
    const blockNode = actionNode.closest("[data-location-block]");
    const ids = parseIdList(actionNode.dataset.locationNoteIds || blockNode?.dataset.locationIds || "");
    const noteKey = actionNode.dataset.locationNoteKey || blockNode?.dataset.locationNoteKey || locationAxisKey(ids);
    saveLocationDescriptionValue(noteKey, ids, actionNode.value ?? ui.locationDescriptionDrafts.get(noteKey) ?? "", options);
  }

  function saveLocationDescriptionValue(noteKey, ids, value, options = {}) {
    const cleaned = normalizeLocationDescription(value);
    const targetIds = ids.length ? ids : [noteKey].filter(Boolean);
    const primaryId = targetIds[0] || noteKey;
    if (!primaryId) return;
    state.locationDescriptions ||= {};
    state.locationDescriptions[dateKey()] ||= {};
    if (cleaned) state.locationDescriptions[dateKey()][primaryId] = cleaned;
    else delete state.locationDescriptions[dateKey()][primaryId];
    targetIds.slice(1).forEach((id) => delete state.locationDescriptions[dateKey()][id]);
    if (!Object.keys(state.locationDescriptions[dateKey()]).length) delete state.locationDescriptions[dateKey()];
    ui.locationDescriptionDrafts.set(noteKey, cleaned);
    saveState();
    if (options.render) render();
  }

  function locationAssignmentOptions(date = dateKey()) {
    const counts = new Map();
    return locationSlicesForRange(0, 1440, date)
      .filter((slice) => slice.type && slice.type !== "empty")
      .map((slice) => {
        const nextCount = (counts.get(slice.type) || 0) + 1;
        counts.set(slice.type, nextCount);
        return {
          id: slice.id,
          label: `${locationLabel(slice.type)}${nextCount} ${minutesToTime(slice.start)}-${minutesToTime(slice.end)}`,
        };
      });
  }

  function assignLocationBlockLogs(selectNode) {
    const targetId = selectNode.value;
    const sourceIds = parseIdList(selectNode.dataset.sourceLocationIds || "");
    if (!targetId || !sourceIds.length) return;
    const sourceSet = new Set(sourceIds);
    ui.logDrafts.forEach((log) => {
      if (log.date === dateKey() && sourceSet.has(log.segmentId)) log.segmentId = targetId;
    });
    setState((draft) => {
      draft.logs[dateKey()] ||= [];
      draft.logs[dateKey()].forEach((log) => {
        if (sourceSet.has(log.segmentId)) log.segmentId = targetId;
      });
    });
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

  function toggleRecordChartSeries(series, checked) {
    if (!["work", "study", "efficiency"].includes(series)) return;
    ui.recordChartSeries[series] = Boolean(checked);
    render();
  }

  function bindRecordChartDrag(root = document) {
    if (!root) return;
    $$("[data-record-chart-drag]", root).forEach((wrap) => {
      if (wrap.dataset.dragBound === "true") return;
      wrap.dataset.dragBound = "true";
      bindChartDrag(wrap, shiftRecordChartWindow);
    });
  }

  function bindChartDrag(wrap, onShift) {
    let startX = 0;
    let pointerId = null;

    wrap.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      startX = event.clientX;
      pointerId = event.pointerId;
      triggerChartWaterMotion();
      wrap.setPointerCapture?.(pointerId);
    });

    wrap.addEventListener("pointerup", (event) => {
      if (pointerId !== event.pointerId) return;

      const deltaX = event.clientX - startX;
      pointerId = null;

      if (Math.abs(deltaX) < 36) return;

      const days = Math.max(1, Math.min(7, Math.round(Math.abs(deltaX) / 70)));
      const direction = deltaX > 0 ? days : -days;

      onShift(direction);
    });

    wrap.addEventListener("pointercancel", () => {
      pointerId = null;
    });
  }

  function shiftRecordChartWindow(direction) {
    const previous = ui.recordChartWindowOffset || 0;
    const next = Math.max(0, previous + (Number(direction) || 0));
    if (next === previous) {
      triggerChartWaterMotion();
      return;
    }
    ui.recordChartWindowOffset = next;
    render();
  }

  function addHolidayRange() {
    ui.holidayEditing = true;
    setState((draft) => {
      draft.holidays ||= [];
      draft.holidays.push({ id: uid(), start: dateKey(), end: dateKey() });
    });
  }

  function toggleHolidayEditing() {
    ui.holidayEditing = !ui.holidayEditing;
    render();
  }

  function saveHolidayEditing() {
    ui.holidayEditing = false;
    render();
  }

  function deleteHolidayRange(holidayId) {
    setState((draft) => {
      draft.holidays = normalizeHolidayRanges(draft.holidays).filter((holiday) => holiday.id !== holidayId);
    });
  }

  function updateHolidayRange(holidayId, field, value) {
    const normalized = normalizeDateKey(value);
    if (!normalized || !["start", "end"].includes(field)) return;
    setState((draft) => {
      const holiday = normalizeHolidayRanges(draft.holidays).find((item) => item.id === holidayId);
      if (!holiday) return;
      holiday[field] = normalized;
      if (holiday.start > holiday.end) {
        if (field === "start") holiday.end = normalized;
        else holiday.start = normalized;
      }
      draft.holidays = normalizeHolidayRanges([...(draft.holidays || []).filter((item) => item.id !== holidayId), holiday]);
    });
  }

  function updateExpectedHours(field, value) {
    if (!["study", "work"].includes(field)) return;
    setState((draft) => {
      draft.settings[field === "study" ? "expectedStudyHours" : "expectedWorkHours"] = normalizedExpectedHours(value);
    });
  }

  function toggleExpectedLine(field, checked) {
    if (!["study", "work"].includes(field)) return;
    setState((draft) => {
      draft.settings[field === "study" ? "expectedStudyVisible" : "expectedWorkVisible"] = Boolean(checked);
    });
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
    ui.locationDescriptionDrafts.clear();
    ui.editingLocationDescriptions.clear();
  }

  function clearRecordDrafts() {
    clearLogDrafts();
    clearLocationDrafts();
  }

  function toggleEditMode(key) {
    if (key === "reviewEditing" && ui[key]) cleanupBulletTextareas(document);
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
      originTargetId: targetLinkId(target),
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
    if (!["red", "green", "summary", "nextDirection"].includes(field)) return;
    const review = weeklyReviewForKey(key || scopeKey("week", reviewDate("week")));
    review[field] = normalizeBulletTextareaValue(value);
    saveState();
  }

  function updateMonthlyReviewField(key, field, value) {
    if (!["redInsight", "greenInsight", "summary", "nextDirection"].includes(field)) return;
    const review = monthlyReviewForKey(key || scopeKey("month", reviewDate("month")));
    review[field] = normalizeBulletTextareaValue(value);
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

  function targetLinkId(target) {
    return String(target?.originTargetId || target?.migration?.sourceTargetId || target?.id || "");
  }

  function targetLinkedIds(target) {
    const origin = targetLinkId(target);
    const ids = new Set([target?.id, target?.originTargetId, target?.migration?.sourceTargetId, origin].filter(Boolean).map(String));
    if (origin) {
      Object.values(state.targets?.day || {}).forEach((items) => {
        (items || []).forEach((item) => {
          if (targetLinkId(item) !== origin) return;
          [item.id, item.originTargetId, item.migration?.sourceTargetId].filter(Boolean).forEach((id) => ids.add(String(id)));
        });
      });
    }
    return ids;
  }

  function targetNameForLogLink(targetId, date = dateKey()) {
    if (!targetId) return "";
    const target = findTargetByLinkId(targetId, date) || findTargetByLinkId(targetId);
    return target?.name || "";
  }

  function findTargetByLinkId(targetId, date = null) {
    const id = String(targetId || "");
    if (!id) return null;
    const matches = (target) => targetLinkedIds(target).has(id) || targetLinkId(target) === id;
    if (date) return targetsForDate(date).find(matches) || null;
    for (const collections of Object.values(state.targets?.day || {})) {
      const target = (collections || []).find(matches);
      if (target) return target;
    }
    return null;
  }

  function targetLoggedMinutes(target, endDate = dateKey()) {
    const ids = targetLinkedIds(target);
    const end = normalizeDateKey(endDate) || dateKey();
    return Object.entries(state.logs || {}).reduce((sum, [itemDate, logs]) => {
      if (normalizeDateKey(itemDate) && itemDate > end) return sum;
      return (
        sum +
        (logs || []).reduce((daySum, log) => {
          return ids.has(String(log.targetId || "")) ? daySum + (Number(log.minutes) || 0) : daySum;
        }, 0)
      );
    }, 0);
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
      const sleepMinutes = sleepMinutesForDate(itemDate);
      if (sleepMinutes > 0) acc[SLEEP_STAT_KEY] = (acc[SLEEP_STAT_KEY] || 0) + sleepMinutes;
      return acc;
    }, {});
  }

  function habitRateForScope(scope = state.reviewScope, date = dateKey()) {
    return habitRateForDates(datesInScope(scope, date));
  }

  function habitRateForDates(dates) {
    if (!state.habits.length) return 0;
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
      summary: review.summary || "",
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
      summary: review.summary || "",
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

  function locationBreakdownForDates(dates) {
    const totals = new Map();
    dates.forEach((itemDate) => {
      const daily = locationTotalsForDay(itemDate);
      locationTypes().forEach((location) => {
        const minutes = daily[`__loc_${location.id}`] || 0;
        if (minutes > 0) totals.set(location.id, (totals.get(location.id) || 0) + minutes);
      });
    });
    const total = sumMinutes(Array.from(totals.values()));
    const entries = locationTypes()
      .filter((location) => totals.has(location.id))
      .map((location) => {
        const minutes = totals.get(location.id) || 0;
        return {
          label: location.name,
          minutes,
          percent: total ? Math.round((minutes / total) * 100) : 0,
          color: location.color,
          valueText: formatHourShortText(minutes),
        };
      });
    return { total, entries };
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

  function normalizeHolidayRanges(holidays = []) {
    if (!Array.isArray(holidays)) return [];
    return holidays
      .map((holiday) => {
        if (!holiday || typeof holiday !== "object") return null;
        const start = normalizeDateKey(holiday.start || holiday.date || todayIso());
        const end = normalizeDateKey(holiday.end || holiday.start || holiday.date || todayIso());
        if (!start || !end) return null;
        return {
          id: holiday.id || uid(),
          start: start <= end ? start : end,
          end: start <= end ? end : start,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }

  function isHolidayDate(date = dateKey()) {
    const key = normalizeDateKey(date);
    if (!key) return false;
    return normalizeHolidayRanges(state.holidays).some((holiday) => holiday.start <= key && key <= holiday.end);
  }

  function normalizedExpectedHours(value) {
    if (value === "" || value === null || value === undefined) return "";
    const number = Math.max(0, Number(value) || 0);
    return number ? String(Math.round(number * 10) / 10) : "";
  }

  function getStudyTag() {
    return state.settings.tags.find((tag) => tag.name === "学习") || state.settings.tags.find((tag) => tag.id === "study") || state.settings.tags.find((tag) => tag.name?.includes("学习"));
  }

  function hasCompleteLocationRecord(date) {
    if (isHolidayDate(date)) return false;
    const locations = normalizeLocationRecords(state.locationLogs?.[date] || {});
    return locations.records.some((entry) => entry.start && entry.end);
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

  function datesBetween(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
    const dates = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(isoFromDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
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

  function targetCountForTag(targets, tag) {
    return (targets || []).filter((target) => targetTag(target) === tag).length;
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

  function shortDateWeekdayText(date) {
    return `${shortDateText(date)}${weekdayText(date)}`;
  }

  function formatHolidayRange(holiday) {
    if (!holiday?.start) return "";
    if (!holiday.end || holiday.start === holiday.end) return shortDateWeekdayText(holiday.start);
    return `${shortDateWeekdayText(holiday.start)} - ${shortDateWeekdayText(holiday.end)}`;
  }

  function weeklyHolidaySummaryText(date) {
    return holidaySummaryTextForDates(datesInScope("week", date), "本周", 4);
  }

  function monthlyHolidaySummaryText(date) {
    return holidaySummaryTextForDates(datesInScope("month", date), "本月", 15);
  }

  function holidaySummaryTextForDates(dates, label, reverseThreshold) {
    const holidayDates = dates.filter((itemDate) => isHolidayDate(itemDate));
    if (!holidayDates.length) return "";
    if (holidayDates.length > reverseThreshold) {
      const workingDates = dates.filter((itemDate) => !isHolidayDate(itemDate));
      if (!workingDates.length) return `${label}都是假期。`;
      return `${label}除${formatHolidayDateGroups(workingDates)}外都是假期。`;
    }
    return `${label}${holidayDates.length}天假期：${formatHolidayDateGroups(holidayDates)}。`;
  }

  function formatHolidayDateGroups(dates) {
    return groupConsecutiveDates(dates)
      .map((group) => {
        if (group.length === 1) return shortDateWeekdayText(group[0]);
        return `${shortDateWeekdayText(group[0])}到${shortDateWeekdayText(group[group.length - 1])}`;
      })
      .join("、");
  }

  function groupConsecutiveDates(dates) {
    const sorted = [...dates].sort();
    const groups = [];
    sorted.forEach((date) => {
      const previousGroup = groups[groups.length - 1];
      const previousDate = previousGroup?.[previousGroup.length - 1];
      if (previousDate && shiftIsoDate(previousDate, 1) === date) previousGroup.push(date);
      else groups.push([date]);
    });
    return groups;
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

  function bulletToneForField(field) {
    return { redInsight: "red", greenInsight: "green", summary: "amber", nextDirection: "blue" }[field] || "blue";
  }

  function renderBulletTextarea({ tone, value = "", action, keyName, key, field, placeholder }) {
    return `
      <div class="bullet-textarea-wrap bullet-${tone}">
        <div class="bullet-line-layer" aria-hidden="true">${renderBulletMarkers(value)}</div>
        <textarea class="bullet-textarea" rows="${textareaRows(value)}" data-action="${escapeAttr(action)}" ${keyName}="${escapeAttr(key)}" data-field="${escapeAttr(field)}" placeholder="">${escapeHtml(value || "")}</textarea>
      </div>
    `;
  }

  function renderBulletMarkers(value, options = {}) {
    const lines = String(value || "").split("\n");
    const showPending = Boolean(options.showPending);
    return (lines.length ? lines : [""])
      .map((line) => {
        const hasBullet = line.trim() || showPending;
        return `<span class="${hasBullet ? "has-bullet" : ""}">${line ? escapeHtml(line) : "&nbsp;"}</span>`;
      })
      .join("");
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

  function reviewNavigatorDisplay(scope, date = dateKey()) {
    if (scope !== "week") return scopeDisplay(scope, date);
    const key = scopeKey(scope, date);
    const end = new Date(`${key}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return `${monthDayText(key)} 至 ${monthDayText(isoFromDate(end))}`;
  }

  function monthDayText(date) {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
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

  function sleepMinutesForDate(date) {
    return Object.entries(externalSleepData?.sleepEntries || {}).reduce((sum, [entryDate, entry]) => {
      return sum + sleepOverlapMinutesForDate(entryDate, entry, date);
    }, 0);
  }

  function sleepDurationFromEntry(entry) {
    if (!entry || typeof entry !== "object") return 0;
    const override = normalizedSleepOverride(entry.totalOverride);
    if (override !== null) return override;
    const interval = sleepClockIntervalForEntry(todayIso(), entry, "sleep", "wake");
    return interval ? interval.duration : 0;
  }

  function sleepOverlapMinutesForDate(entryDate, entry, targetDate) {
    const interval = sleepClockIntervalForEntry(entryDate, entry, "sleep", "wake");
    const override = normalizedSleepOverride(entry?.totalOverride);
    if (!interval) return override !== null && entryDate === targetDate ? override : 0;
    const overlap = absoluteOverlapForDate(interval, targetDate);
    if (!overlap) return 0;
    const duration = override !== null ? override : interval.duration;
    return interval.duration ? overlap * (duration / interval.duration) : 0;
  }

  function sleepDormIntervalsForDate(date) {
    return Object.entries(externalSleepData?.sleepEntries || {})
      .map(([entryDate, entry]) => ({
        entryDate,
        interval: sleepClockIntervalForEntry(entryDate, entry, "bed", "rise"),
      }))
      .filter((item) => item.interval)
      .map(({ entryDate, interval }) => {
        const overlap = absoluteOverlapRangeForDate(interval, date);
        if (!overlap) return null;
        return {
          id: `sleep-dorm-${entryDate}-${date}-${Math.round(overlap.start)}-${Math.round(overlap.end)}`,
          type: "dorm",
          start: overlap.start,
          end: overlap.end,
        };
      })
      .filter(Boolean);
  }

  function sleepDormEntriesForDate(date) {
    return sleepDormIntervalsForDate(date).map((interval) => ({
      id: interval.id,
      type: "dorm",
      start: minutesToTime(interval.start),
      end: minutesToTime(interval.end),
      source: "sleep",
      synced: true,
    }));
  }

  function sleepClockIntervalForEntry(entryDate, entry, startField, endField) {
    if (!entry || typeof entry !== "object") return null;
    const start = clockTimeToMinutes(entry[startField]);
    const end = clockTimeToMinutes(entry[endField]);
    if (start === null || end === null || start === end) return null;
    const startDate = start > end ? shiftIsoDate(entryDate, -1) : entryDate;
    const startAbs = absoluteMinute(startDate, start);
    const endAbs = absoluteMinute(entryDate, end);
    if (endAbs <= startAbs) return null;
    return { startAbs, endAbs, duration: endAbs - startAbs };
  }

  function absoluteOverlapForDate(interval, date) {
    const overlap = absoluteOverlapRangeForDate(interval, date);
    return overlap ? overlap.end - overlap.start : 0;
  }

  function absoluteOverlapRangeForDate(interval, date) {
    const dayStart = absoluteMinute(date, 0);
    const start = Math.max(interval.startAbs, dayStart);
    const end = Math.min(interval.endAbs, dayStart + 1440);
    if (end <= start) return null;
    return { start: start - dayStart, end: end - dayStart };
  }

  function absoluteMinute(date, minute) {
    return Math.round(new Date(`${date}T00:00:00`).getTime() / 60000) + minute;
  }

  function shiftIsoDate(date, days) {
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + days);
    return isoFromDate(next);
  }

  function normalizedSleepOverride(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
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

  function parseDateKey(key) {
    const normalized = normalizeDateKey(key) || dateKey();
    return new Date(`${normalized}T00:00:00`);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function timeToMinutes(value) {
    const [hours, minutes] = String(value || "00:00").split(":").map(Number);
    return clamp((hours || 0) * 60 + (minutes || 0), 0, 1439);
  }

  function clockTimeToMinutes(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function minutesToTime(value) {
    const minutes = ((Math.round(value) % 1440) + 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function locationTypes() {
    state.settings.locationTypes = normalizeLocationTypes(state.settings.locationTypes);
    state.settings.defaultLocationId = normalizeLocationId(state.settings.defaultLocationId, state.settings.locationTypes);
    return state.settings.locationTypes;
  }

  function normalizeLocationTypes(types = []) {
    const incoming = Array.isArray(types) ? types : [];
    const fallbackById = new Map(defaultLocationTypes.map((item) => [item.id, item]));
    const list = [];
    const seen = new Set();
    incoming.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const fallback = fallbackById.get(item.id) || defaultLocationTypes[index % defaultLocationTypes.length];
      const id = normalizeLocationTypeId(item.id) || fallback?.id || `location-${index + 1}`;
      if (seen.has(id)) return;
      seen.add(id);
      list.push({
        id,
        name: String(item.name || fallback?.name || "地点").trim() || "地点",
        color: normalizeColor(item.color, fallback?.color || colors[index % colors.length]),
      });
    });
    defaultLocationTypes.forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      list.push({ ...item });
    });
    return list.length ? list : defaultLocationTypes.map((item) => ({ ...item }));
  }

  function normalizeLocationTypeId(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "")
      .slice(0, 48);
  }

  function normalizeLocationId(value, types = normalizeLocationTypes()) {
    const ids = new Set(types.map((item) => item.id));
    if (ids.has(value)) return value;
    if (ids.has(DEFAULT_LOCATION_ID)) return DEFAULT_LOCATION_ID;
    return types[0]?.id || DEFAULT_LOCATION_ID;
  }

  function normalizeColor(value, fallback = colors[0]) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
  }

  function defaultLocationId() {
    return normalizeLocationId(state.settings.defaultLocationId, locationTypes());
  }

  function locationMeta(type) {
    if (!type || type === "empty") return { id: "empty", name: "未计入地点", color: "#d8ddd2" };
    return locationTypes().find((item) => item.id === type) || defaultLocationTypes.find((item) => item.id === type) || { id: type, name: "地点", color: colors[0] };
  }

  function locationLabel(type) {
    return locationMeta(type).name;
  }

  function locationColor(type) {
    return locationMeta(type).color;
  }

  function locationSoftColor(type, alpha = 0.14) {
    return hexToRgba(locationColor(type), alpha);
  }

  function hexToRgba(hex, alpha = 1) {
    const normalized = normalizeColor(hex, colors[0]).replace("#", "");
    const value = Number.parseInt(normalized, 16);
    const red = (value >> 16) & 255;
    const green = (value >> 8) & 255;
    const blue = value & 255;
    return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
  }

  function formatLocationRange(entry) {
    return `${entry.start || ""} - ${entry.openEnd ? "" : entry.end || ""}`;
  }

  function recordAxisRange() {
    return { start: 0, end: 1440 };
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
    const slices = points.slice(0, -1).map((point, index) => {
      const next = points[index + 1];
      const interval = locationIntervalAt((point + next) / 2, date, intervals);
      const type = interval?.type || DEFAULT_LOCATION_ID;
      const id = interval?.id || autoOutdoorId(date, point, next);
      return {
        id,
        ids: [id],
        type,
        start: point,
        end: next,
        auto: !interval,
        percent: ((next - point) / (end - start)) * 100,
      };
    });
    return mergeAdjacentLocationSlices(slices, start, end);
  }

  function mergeAdjacentLocationSlices(slices, rangeStart, rangeEnd) {
    const merged = [];
    slices.forEach((slice) => {
      const previous = merged[merged.length - 1];
      if (previous && previous.type === slice.type && previous.end === slice.start) {
        previous.end = slice.end;
        previous.ids = Array.from(new Set([...(previous.ids || []), ...(slice.ids || [])]));
        previous.id ||= slice.id;
        previous.auto = Boolean(previous.auto || slice.auto);
        return;
      }
      merged.push({ ...slice, ids: [...(slice.ids || [])] });
    });
    return merged.map((slice) => ({
      ...slice,
      percent: ((slice.end - slice.start) / (rangeEnd - rangeStart)) * 100,
    }));
  }

  function locationIntervals(date = dateKey()) {
    const records = normalizeLocationRecords(state.locationLogs?.[date] || {});
    const displayRecords = inferLocationRecordEnds(records.records, date);
    const overriddenSleepIds = new Set(records.records.map((row) => row.id).filter((id) => String(id).startsWith("sleep-dorm-")));
    return [
      ...sleepDormIntervalsForDate(date).filter((interval) => !overriddenSleepIds.has(interval.id)),
      ...displayRecords.flatMap((row) => splitLocationRange(row.type, row.start, row.end, row.id, row)),
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
    const records = [];
    const pushRows = (rows, type) => {
      (rows || []).forEach((row) => {
        const normalized = normalizeLocationRecordRow(row, type);
        if (normalized) records.push(normalized);
      });
    };
    if (Array.isArray(locations.records)) pushRows(locations.records);
    Object.entries(locations || {}).forEach(([type, rows]) => {
      if (type === "records" || !Array.isArray(rows)) return;
      pushRows(rows, type);
    });
    if (!records.length && (locations.workArrive || locations.dormArrive)) {
      pushRows(normalizeLocations(locations).work, "work");
      pushRows(normalizeLocations(locations).dorm, "dorm");
    }
    return { records };
  }

  function normalizeLocationRecordRow(row, typeFallback = "") {
    if (!row) return null;
    const start = row.start ?? row.arrive ?? "";
    const end = row.end ?? row.leave ?? "";
    if (!start && !end) return null;
    return {
      id: row.id || uid(),
      type: row.type || typeFallback || DEFAULT_LOCATION_ID,
      start,
      end,
      source: row.source || "",
      synced: Boolean(row.synced),
    };
  }

  function locationDisplayRecordsForDate(date = dateKey(), source = null) {
    const locations = normalizeLocationRecords(source || state.locationLogs?.[date] || {});
    return inferLocationRecordEnds(locations.records, date);
  }

  function inferLocationRecordEnds(records = [], date = dateKey()) {
    const range = recordAxisRange();
    const rangeEnd = minutesToTime(range.end);
    const sorted = (records || [])
      .filter((row) => row.type && row.start)
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    return sorted.map((row, index) => {
      const rawEnd = row.end || "";
      const nextStart = sorted
        .slice(index + 1)
        .map((item) => item.start)
        .find((start) => timeToMinutes(start) > timeToMinutes(row.start));
      const end = rawEnd || nextStart || rangeEnd;
      return {
        ...row,
        rawEnd,
        end,
        openEnd: !rawEnd,
      };
    });
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
    const displayRecords = inferLocationRecordEnds(locations.records, date);
    const overriddenSleepIds = new Set(locations.records.map((row) => row.id).filter((id) => String(id).startsWith("sleep-dorm-")));
    return [
      ...displayRecords.map((row) => ({
        id: row.id,
        type: row.type,
        start: row.start,
        end: row.end,
        rawEnd: row.rawEnd,
        openEnd: row.openEnd,
        source: row.source,
        synced: row.synced,
      })),
      ...sleepDormEntriesForDate(date).filter((entry) => !overriddenSleepIds.has(entry.id)),
    ].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }

  function mergedLocationEntriesForDate(date = dateKey(), source = null) {
    const entries = locationEntriesForDate(date, source)
      .filter((entry) => entry.type && entry.start && entry.end)
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    const merged = [];
    entries.forEach((entry) => {
      const previous = merged[merged.length - 1];
      const canMerge =
        previous &&
        previous.type === entry.type &&
        !previous.synced &&
        !entry.synced &&
        previous.end === entry.start;
      if (canMerge) {
        previous.end = entry.end;
        previous.rawEnd = entry.rawEnd;
        previous.openEnd = entry.openEnd;
        previous.ids.push(entry.id);
        return;
      }
      merged.push({ ...entry, ids: [entry.id] });
    });
    return merged;
  }

  function persistLocationEntry(draft, entry) {
    draft.locationLogs ||= {};
    const date = entry.date || dateKey();
    const daily = normalizeLocationRecords(draft.locationLogs[date] || {});
    const ids = entry.ids?.length ? entry.ids : [entry.id];
    daily.records = daily.records.filter((row) => !ids.includes(row.id));
    const remap = new Map();
    if (!entry.type) removeLocationDescriptions(draft, date, ids);
    if (entry.type && entry.start && (!entry.end || entry.start !== entry.end || isFullDayLocationRecord(entry))) {
      daily.records.push({ id: entry.id, type: entry.type, start: entry.start || "", end: entry.end || "" });
      ids.filter((id) => id !== entry.id).forEach((id) => remap.set(id, entry.id));
    }
    mergeAdjacentLocationRecords(daily).forEach((targetId, sourceId) => remap.set(sourceId, targetId));
    remapLocationLogSegments(draft, date, remap);
    remapLocationDescriptions(draft, date, remap);
    draft.locationLogs[date] = daily;
  }

  function mergeAdjacentLocationRecords(daily) {
    daily.records = (daily.records || [])
      .filter((row) => row.type && row.start && (!row.end || row.start !== row.end || isFullDayLocationRecord(row)))
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    const remap = new Map();
    const merged = [];
    daily.records.forEach((row) => {
      const previous = merged[merged.length - 1];
      const canMerge =
        previous &&
        previous.type === row.type &&
        previous.end &&
        row.end &&
        !previous.synced &&
        !row.synced &&
        previous.end === row.start;
      if (canMerge) {
        previous.end = row.end;
        remap.set(row.id, previous.id);
        return;
      }
      merged.push(row);
    });
    daily.records = merged;
    return remap;
  }

  function remapLocationLogSegments(draft, date, remap) {
    if (!remap.size) return;
    (draft.logs?.[date] || []).forEach((log) => {
      if (remap.has(log.segmentId)) log.segmentId = remap.get(log.segmentId);
    });
    ui.logDrafts.forEach((log) => {
      if (log.date === date && remap.has(log.segmentId)) log.segmentId = remap.get(log.segmentId);
    });
  }

  function remapLocationDescriptions(draft, date, remap) {
    if (!remap.size) return;
    const descriptions = draft.locationDescriptions?.[date];
    if (!descriptions) return;
    remap.forEach((targetId, sourceId) => {
      if (!descriptions[sourceId]) return;
      descriptions[targetId] = [descriptions[targetId], descriptions[sourceId]].filter(Boolean).join("\n");
      delete descriptions[sourceId];
    });
  }

  function removeLocationDescriptions(draft, date, ids = []) {
    const descriptions = draft.locationDescriptions?.[date];
    if (!descriptions) return;
    ids.forEach((id) => delete descriptions[id]);
    if (!Object.keys(descriptions).length) delete draft.locationDescriptions[date];
  }

  function splitLocationRange(type, startValue, endValue, id = "", source = {}) {
    const start = timeToMinutes(startValue);
    const end = timeToMinutes(endValue);
    if (start === end) {
      if (isFullDayLocationRecord({ start: startValue, end: endValue })) {
        return [{ id, type, source: source.source || "", synced: Boolean(source.synced), start: 0, end: 1440 }];
      }
      return [];
    }
    const base = { id, type, source: source.source || "", synced: Boolean(source.synced) };
    if (end > start) return [{ ...base, start, end }];
    return [
      { ...base, start, end: 1440 },
      { ...base, start: 0, end },
    ];
  }

  function isFullDayLocationRecord(entry = {}) {
    return String(entry.start || "") === "00:00" && String(entry.end || "") === "00:00";
  }

  function locationIntervalAt(minute, date = dateKey(), cachedIntervals = null) {
    const normalized = ((minute % 1440) + 1440) % 1440;
    const intervals = cachedIntervals || locationIntervals(date);
    for (let index = intervals.length - 1; index >= 0; index -= 1) {
      const interval = intervals[index];
      if (normalized >= interval.start && normalized < interval.end) return interval;
    }
    return null;
  }

  function locationTypeAt(minute, date = dateKey(), cachedIntervals = null) {
    return locationIntervalAt(minute, date, cachedIntervals)?.type || DEFAULT_LOCATION_ID;
  }

  function emptyLocationTotals() {
    const totals = { __loc_dorm: 0, __loc_work: 0, __loc_outdoor: 0 };
    if (state?.settings) locationTypes().forEach((item) => (totals[`__loc_${item.id}`] ||= 0));
    return totals;
  }

  function locationTotalsForScope(scope, date = dateKey()) {
    return datesInScope(scope, date).slice(0, baselineDaysInScope(scope)).reduce((totals, itemDate) => {
      const daily = locationTotalsForDay(itemDate);
      Object.entries(daily).forEach(([key, minutes]) => {
        totals[key] = (totals[key] || 0) + minutes;
      });
      return totals;
    }, emptyLocationTotals());
  }

  function locationTotalsForDay(date = dateKey()) {
    if (isHolidayDate(date)) return emptyLocationTotals();
    const slices = locationSlicesForRange(0, 1440, date);
    return slices.reduce((totals, slice) => {
      if (!slice.type || slice.type === "empty") return totals;
      const key = `__loc_${slice.type}`;
      totals[key] = (totals[key] || 0) + slice.end - slice.start;
      return totals;
    }, emptyLocationTotals());
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

  function formatHourShortText(minutes) {
    const hours = (Number(minutes) || 0) / 60;
    if (!hours) return "0h";
    const rounded = Math.round(hours * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
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

  function prepareTextareas(root = document) {
    $$("textarea", root).forEach((textarea) => {
      updateBulletTextareaMarkers(textarea);
      autoResizeTextarea(textarea);
    });
  }

  function autoResizeTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.id === "backup-text") return;
    const minHeight = parseFloat(getComputedStyle(textarea).minHeight) || 76;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
    updateBulletTextareaMarkers(textarea);
  }

  function cleanupBulletTextareas(root = document) {
    $$("textarea.bullet-textarea", root).forEach((textarea) => sanitizeBulletTextarea(textarea, { removeEmptyLines: true, dispatch: true }));
  }

  function sanitizeBulletTextarea(textarea, options = {}) {
    const cleaned = normalizeBulletTextareaValue(textarea.value, options);
    if (cleaned === textarea.value) {
      autoResizeTextarea(textarea);
      return;
    }
    textarea.value = cleaned;
    autoResizeTextarea(textarea);
    if (options.dispatch) textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function updateBulletTextareaMarkers(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement) || !textarea.classList.contains("bullet-textarea")) return;
    const layer = textarea.closest(".bullet-textarea-wrap")?.querySelector(".bullet-line-layer");
    if (!layer) return;
    layer.innerHTML = renderBulletMarkers(textarea.value, { showPending: document.activeElement === textarea });
  }

  function normalizeBulletTextareaValue(value, options = {}) {
    const lines = String(value || "")
      .split("\n")
      .map((line) => line.replace(/^\s*(?:[•●·]\s*)+/, "").trimEnd());
    return (options.removeEmptyLines ? lines.filter((line) => line.trim()) : lines).join("\n");
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
