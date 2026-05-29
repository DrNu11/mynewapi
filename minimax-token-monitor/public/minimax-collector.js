(function () {
  if (window.__minimaxTokenMonitorCollector) {
    window.__minimaxTokenMonitorCollector.refresh();
    return;
  }

  const monitor = "http://127.0.0.1:8787";
  const state = {
    timer: null,
    running: true,
    lastError: null,
    lastPayload: null
  };

  function formatTimeRange(start, end, weekly) {
    if (!start || !end) return "";
    const opts = weekly
      ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }
      : { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" };
    const a = new Intl.DateTimeFormat("zh-CN", opts).format(new Date(start));
    const b = new Intl.DateTimeFormat("zh-CN", opts).format(new Date(end));
    return weekly ? `${a} - ${b}(UTC+8)` : `${a}-${b}(UTC+8)`;
  }

  function formatRemaining(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}后重置`;
    return `${minutes} 分钟后重置`;
  }

  function normalizeQuota(row, mode) {
    const weekly = mode === "weekly";
    const total = Number(weekly ? row.current_weekly_total_count : row.current_interval_total_count) || 0;
    const remaining = Number(weekly ? row.current_weekly_usage_count : row.current_interval_usage_count) || 0;
    const used = Math.max(0, total - remaining);
    const percent = total > 0 ? Math.round((used / total) * 100) : 0;
    return {
      total,
      remaining,
      used,
      percent,
      timeRange: formatTimeRange(
        weekly ? row.weekly_start_time : row.start_time,
        weekly ? row.weekly_end_time : row.end_time,
        weekly
      ),
      remainsTimeText: formatRemaining(weekly ? row.weekly_remains_time : row.remains_time)
    };
  }

  function pickTextGeneration(remains) {
    const categories = Array.isArray(remains && remains.category_remains) ? remains.category_remains : [];
    const models = Array.isArray(remains && remains.model_remains) ? remains.model_remains : [];
    const category = categories.find(item => item.category === "text_generation" || item.display_name === "文本生成");
    const model = models.find(item => item.model_name === "MiniMax-M*");
    const row = category || model;
    if (!row) return null;
    return {
      source: category ? "category_remains" : "model_remains",
      title: (category && category.display_name) || "文本生成",
      rawName: (category && category.category) || (model && model.model_name) || "",
      fiveHour: normalizeQuota(row, "fiveHour"),
      weekly: Number(row.current_weekly_total_count || 0) > 0 ? normalizeQuota(row, "weekly") : null,
      raw: row
    };
  }

  async function refresh() {
    try {
      const response = await fetch("/v1/api/openplatform/coding_plan/remains", {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json, text/plain, */*" }
      });
      const remains = await response.json();
      if (!response.ok) throw new Error(`MiniMax HTTP ${response.status}`);

      const textGeneration = pickTextGeneration(remains);
      if (!textGeneration) throw new Error("没有找到文本生成配额");

      const payload = {
        fetchedAt: new Date().toISOString(),
        textGeneration,
        rawBaseResp: remains.base_resp || null
      };

      await fetch(`${monitor}/api/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      state.lastPayload = payload;
      state.lastError = null;
      console.log("[MiniMax Monitor] pushed", payload.textGeneration.fiveHour);
    } catch (error) {
      state.lastError = error.message;
      console.warn("[MiniMax Monitor] failed:", error);
    }
  }

  function start() {
    if (state.timer) clearInterval(state.timer);
    refresh();
    state.timer = setInterval(refresh, 30_000);
  }

  function stop() {
    state.running = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    console.log("[MiniMax Monitor] stopped");
  }

  window.__minimaxTokenMonitorCollector = { refresh, stop, state };
  start();
})();
