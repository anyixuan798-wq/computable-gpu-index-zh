/* Computable GPU Index (CGI) 中文实时看板 — 前端逻辑
   实时卡片:直连 data.getcomputable.com/latest.json (CORS 开放, 60s 刷新)
   历史图表:同站 data/snapshot.json (GitHub Actions 每 15 分钟自动更新)
*/
"use strict";

const LIVE_URL = "https://data.getcomputable.com/latest.json";
const SNAP_URL = "data/snapshot.json";

const SKUS = ["H100", "H200", "B200", "B300"];
const DISP = {
  H100: { full: "NVIDIA H100 SXM", spec: "规格:1 个 NVIDIA H100 SXM 加速器·时" },
  H200: { full: "NVIDIA H200 SXM", spec: "规格:1 个 NVIDIA H200 SXM 加速器·时" },
  B200: { full: "NVIDIA B200", spec: "规格:1 个 NVIDIA B200 加速器·时" },
  B300: { full: "NVIDIA B300", spec: "规格:1 个 NVIDIA B300 加速器·时" },
};
const LANE_RANGE_MS = 24 * 3600; // 车道 1D 变化(与序列时间戳同为秒)
const RANGES = { "24H": 24 * 3600, "7D": 7 * 24 * 3600, "30D": 30 * 24 * 3600, "90D": 90 * 24 * 3600 };

const S = { sku: "B300", range: "30D", live: {}, snap: null, chart: null, chartLib: false, timer: null };

const $ = (id) => document.getElementById(id);
const fmtPx = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
const cls = (v) => (Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down");
const arrow = (v) => (Math.abs(v) < 0.005 ? "•" : v > 0 ? "▲" : "▼");

function fmtDT(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("zh-CN", { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDTCN(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDayUTC(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/* ---------- 数据获取 ---------- */
async function getJSON(url, opts) {
  const r = await fetch(url, Object.assign({ cache: "no-store" }, opts));
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

/* latest.json -> 每 SKU 最新观测(observed_at 最大者即当前发布值) */
function pickLatest(root) {
  const map = {};
  for (const o of root.data.observations || []) {
    const cur = map[o.sku];
    if (!cur || o.observed_at > cur.observed_at) map[o.sku] = o;
  }
  return map;
}

async function refreshLive() {
  try {
    const root = await getJSON(LIVE_URL);
    S.live = pickLatest(root);
    setLiveDot(true);
    $("errBox").style.display = "none";
    renderAll();
  } catch (e) {
    setLiveDot(false);
    (window.__errs = window.__errs || []).push("live: " + e.message);
    showErr("实时数据源(data.getcomputable.com)连接失败:" + e.message + " — 60 秒后自动重试。");
  }
}

async function loadSnapshot() {
  try {
    const snap = await getJSON(SNAP_URL, { cache: "reload" });
    if (snap && snap.skus && snap.skus[S.sku]) {
      S.snap = snap;
      renderAll();
    }
  } catch (e) {
    showErr("历史快照 data/snapshot.json 加载失败:" + e.message);
  }
}

/* ---------- 渲染 ---------- */
function curObs() { return S.live[S.sku] || null; }
function seriesFor(sku) { return S.snap ? (S.snap.skus[sku] || {}).series || [] : []; }
/* 剔除 value 为 null 的边界/暖机行(发布起点行无值) */
function validSeries(sku) { return seriesFor(sku).filter((p) => p[1] != null); }
function firstTs(sku) { const s = seriesFor(sku); return s.length ? s[0][0] : null; }
function lastTs(sku) { const s = seriesFor(sku); return s.length ? s[s.length - 1][0] : null; }

/* 窗口变化 %:相对窗口起点前最近一点(无则用窗口内首点) */
function winChange(sku, ms) {
  const s = validSeries(sku);
  if (s.length < 2) return null;
  const end = lastTs(sku);
  const start = end - ms;
  let ref = null;
  for (let i = 0; i < s.length; i++) { if (s[i][0] >= start) { ref = i === 0 ? s[0][1] : s[i - 1][1]; break; } }
  if (ref == null) ref = s[s.length - 1][1];
  const last = s[s.length - 1][1];
  return { pct: (last - ref) / ref * 100, firstVal: ref, refTs: start };
}

function heroSinceDate(sku) {
  const t = firstTs(sku);
  if (!t) return "—";
  const d = new Date(t * 1000);
  return (d.getUTCMonth() + 1) + "月" + d.getUTCDate() + "日";
}

function renderAll() {
  refreshRepro();
  const o = curObs();
  if (o) { renderHero(o); renderLanes(); renderStats(o); renderReceipts(o); renderSpread(o); renderLogPanel(); }
  if (S.snap) { renderChart(); renderMeth(); }
}

function renderHero(o) {
  const sku = S.sku;
  const d = DISP[sku];
  $("heroEyebrow").textContent = "指数 · " + d.full + " · 按需 · 美元/GPU·时";
  $("heroPrice").textContent = o ? o.value_usd_gpu_hr.toFixed(2) : "—";
  $("heroBand").textContent = o ? "± $" + (o.stability_band_usd_gpu_hr || 0).toFixed(2) : "—";
  $("heroAsOf").textContent = o ? fmtDT(o.observed_at) + " UTC" : "—";
  $("heroAsOfCn").textContent = o ? fmtDTCN(o.observed_at) : "—";
  // 新鲜度
  if (o) {
    const ageMin = (Date.now() - new Date(o.observed_at).getTime()) / 60000;
    const f = ageMin < 20 ? "新鲜 (15 分钟粒度)" : ageMin < 90 ? "正常" : "滞后 " + Math.round(ageMin / 60) + " 小时";
    $("heroFresh").textContent = f;
  }
  // 发布以来变化(主徽标, 与原站 SINCE AUG 10 同语义)
  const wc = winChange(sku, Number.MAX_SAFE_INTEGER);
  const pctEl = $("heroPct");
  if (wc && o) {
    pctEl.className = "pct-badge " + cls(wc.pct);
    pctEl.innerHTML = '<span class="num">' + arrow(wc.pct) + " " + fmtPct(wc.pct) + "</span><span class='ctx'>发布以来 (自 " + heroSinceDate(sku) + ")</span>";
  } else {
    pctEl.className = "pct-badge";
    pctEl.innerHTML = '<span class="spin"></span>';
  }
  const all = o.receipts || [];
  const nOk = all.filter((r) => r.status === "ok" && r.filter_verdict === "accepted").length;
  $("heroDesc").innerHTML =
    "CGI 是全球首个开源 GPU 算力价格指数:容错、抗离群值、人人可核验可复现。" +
    "本次为 <b>" + d.full + "</b> 观测,来源面板 <b>" + all.length + " 家</b> 公开报价(" +
    nOk + " 家通过过滤),聚合方法 = 加权截尾均值投票。" + d.spec +
    ' <a href="#methodology">方法学详情 →</a>';
}

function renderLanes() {
  const box = $("laneList");
  box.innerHTML = "";
  for (const sku of SKUS) {
    const o = S.live[sku];
    const wc = winChange(sku, LANE_RANGE_MS);
    const it = document.createElement("button");
    it.className = "lane" + (sku === S.sku ? " active" : "");
    const pct = wc ? wc.pct : null;
    it.innerHTML =
      '<span class="nm">' + DISP[sku].full + "</span>" +
      '<span class="px num">' + (o ? fmtPx(o.value_usd_gpu_hr) : "—") + "</span>" +
      '<span class="chg"><span class="delta num ' + (pct == null ? "flat" : cls(pct)) + '">' +
      (pct == null ? "—" : arrow(pct) + " " + fmtPct(pct)) + " 24H</span>" +
      '<span class="asof">' + (o ? fmtDT(o.observed_at) + " UTC" : "") + "</span></span>";
    it.onclick = () => { S.sku = sku; renderAll(); };
    box.appendChild(it);
  }
}

function renderStats(o) {
  const all = o.receipts || [];
  const nPass = all.filter((r) => r.status === "ok" && r.filter_verdict === "accepted").length;
  $("stSources").innerHTML = nPass + "/" + all.length + " <small>家来源</small>";
  let hi = null, lo = null;
  for (const r of all) {
    if (r.price == null || r.filter_verdict !== "accepted") continue;
    if (!hi || r.price > hi.price) hi = r;
    if (!lo || r.price < lo.price) lo = r;
  }
  $("stHigh").innerHTML = hi ? fmtPx(hi.price) + ' <small>' + hi.source_id + "</small>" : "—";
  $("stLow").innerHTML = lo ? fmtPx(lo.price) + ' <small>' + lo.source_id + "</small>" : "—";
  const wc = winChange(S.sku, Number.MAX_SAFE_INTEGER);
  const el = $("stSince");
  if (wc) {
    el.className = "v num " + cls(wc.pct);
    el.innerHTML = arrow(wc.pct) + " " + fmtPct(wc.pct) + ' <small>自 ' + heroSinceDate(S.sku) + "</small>";
  } else el.innerHTML = "—";
}

function renderReceipts(o) {
  $("panelSkuTag").textContent = DISP[S.sku].full;
  const all = (o.receipts || []).slice().sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const tbody = $("recTbody");
  if (!all.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:#8a8a8a">暂无来源明细</td></tr>'; return; }
  const wMax = Math.max(...all.map((r) => r.weight || 0));
  tbody.innerHTML = all.map((r) =>
    "<tr class='src'><td><a class='src-name' href='" + (r.source_url || "#") + "' target='_blank' rel='noopener'>" +
    r.source_id + '<span class="url-ic">↗</span></a>' + (r.filter_verdict !== "accepted" ? ' <span style="color:#c23b2e;font-size:11px">排除</span>' : "") + "</td>" +
    '<td class="px num">' + fmtPx(r.price) + "</td>" +
    '<td class="band num">± $' + (r.sd || 0).toFixed(2) + "</td>" +
    '<td class="wt"><span class="wtbar"><i style="width:' + Math.round((r.weight || 0) / wMax * 100) + '%"></i></span><span class="wtv num">' +
    ((r.weight || 0) * 100).toFixed(1) + "%</span></td>" +
    '<td class="band" style="font-size:12px">' + (r.region || "—") + "</td></tr>"
  ).join("");
  const nPass = all.filter((r) => r.status === "ok" && r.filter_verdict === "accepted").length;
  $("panelNote").innerHTML = "以上为 " + DISP[S.sku].full + " 最近一次观测(" + fmtDTCN(o.observed_at) + ")的 " +
    nPass + "/" + all.length + " 家来源;权重 = 活跃度加权后的投票权,随历史出勤与报价误差自动调整。" +
    "每一行来源名都链接到其公开报价页,可点击核对。";
}

function renderSpread(o) {
  const all = (o.receipts || []).filter((r) => r.price != null && r.filter_verdict === "accepted");
  if (all.length < 2) return;
  const lo = Math.min(...all.map((r) => r.price)), hi = Math.max(...all.map((r) => r.price));
  const span = hi - lo || 1;
  const px = (v) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  $("spMin").textContent = fmtPx(lo);
  $("spMax").textContent = fmtPx(hi);
  $("spIdx").textContent = "指数 " + fmtPx(o.value_usd_gpu_hr);
  $("spreadIdx").style.left = px(o.value_usd_gpu_hr) + "%";
  $("spreadDots").innerHTML = all.map((r) =>
    '<span class="dot" style="left:' + px(r.price) + '%" title="' + r.source_id + " " + fmtPx(r.price) + '"></span>'
  ).join("");
}

function renderLogPanel() {
  $("logSkuTag").textContent = DISP[S.sku].full;
  $("logSkuFile").textContent = S.sku.toLowerCase();
  const body = $("logBody");
  const rows = (S.snap && S.snap.receipt_log || []).filter((l) => l.sku === S.sku);
  if (!rows.length) {
    body.innerHTML = '<div style="padding:14px;color:#8a8a8a">暂无变动记录 — 定时抓取器会在检测到来源报价变化后在此追加(约每 15 分钟一轮)。</div>';
    return;
  }
  body.innerHTML = rows.slice(0, 80).map((l) => {
    const d = l.d == null ? "" : (l.d > 0 ? '<span class="d up num">▲' + Math.abs(l.d).toFixed(2) + "</span>" : l.d < 0 ? '<span class="d down num">▼' + Math.abs(l.d).toFixed(2) + "</span>" : '<span class="d num">•0.00</span>');
    const tm = new Date(l.t).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
    return '<div class="log-line"><span class="t num">' + tm + '</span><span class="s">' + l.src +
      '</span><span class="p num">' + (l.price == null ? "—" : l.price.toFixed(2)) + "</span>" + d +
      '<span class="u">' + (l.u || "") + "</span></div>";
  }).join("") +
    '<div style="padding:8px 12px;color:#b5b5b5;font-size:11px">↑ 最新 ' + Math.min(rows.length, 80) + " 条 · 来源:本站抓取器对比各轮观测 receipts 所得</div>";
}

/* ---------- 方法学参数 ---------- */
function renderMeth() {
  const o = curObs();
  if (!o || !o.calc_params) { $("methParams").textContent = "—"; return; }
  const c = o.calc_params, l = c.liveness || {};
  $("methParams").innerHTML =
    "<span>聚合:" + c.aggregation + " α=" + c.iqm_alpha + "</span>" +
    "<span>采集:每 " + c.collection_interval + " 一轮</span>" +
    "<span>σ过滤:" + c.filter_sigma + "σ (下限 " + c.filter_sigma_floor_pct + "%)</span>" +
    "<span>缺席容忍:" + (c.carry_forward_window_hours || 72) + "h</span>" +
    "<span>权重方案:" + l.scheme + " (λ=" + l.ridge_lambda + ", 半衰期 " + l.half_life_days + " 天)</span>" +
    "<span>权重范围:" + l.weight_min + "–" + l.weight_max + "</span>" +
    "<span>方法学版本:" + o.methodology_id + "</span>" +
    "<span>输入快照 sha256:" + (o.input_snapshot_sha256 || "").slice(0, 16) + "…</span>";
}

/* ---------- 图表 ---------- */
function waitEcharts(cb) {
  if (window.echarts) { cb(); return; }
  let n = 0;
  const t = setInterval(() => {
    n += 500;
    if (window.echarts || n > 20000) { clearInterval(t); window.echarts ? cb() : ($("chart").innerHTML = '<div style="padding:40px;text-align:center;color:#8a8a8a">图表库加载失败(需要访问 jsdelivr/npmmirror CDN),请检查网络后刷新。</div>'); }
  }, 500);
}

function drawChart() {
  if (!window.echarts || !S.snap) return;
  const wrap = $("chart");
  try {
    if (S.chart) { S.chart.dispose(); S.chart = null; }
    S.chart = window.echarts.init(wrap, null, { renderer: "canvas" });

    const sku = S.sku;
    const series = validSeries(sku);
    if (!series.length) return;

    const ms = RANGES[S.range] || RANGES["30D"];
    const end = lastTs(sku);
    const cut = end - ms;
    const idx0 = Math.max(0, series.findIndex((p) => p[0] >= cut) - 1);
    const view = series.slice(idx0);
    const last = view[view.length - 1];
    const curVal = last[1];

    const line = view.map((p) => [p[0] * 1000, p[1]]);
    const lower = view.map((p) => [p[0] * 1000, Math.max(0, p[1] - (p[2] || 0))]);
    const bandH = view.map((p) => [p[0] * 1000, (p[2] || 0) * 2]);

    const opt = {
      animation: false,
      grid: { left: 62, right: 20, top: 26, bottom: 34 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#111", borderWidth: 0, textStyle: { color: "#eee", fontSize: 12 },
        formatter: (ps) => {
          const i = ps[0].dataIndex;
          const v = view[i][1], b = view[i][2] || 0;
          return fmtDTCN(view[i][0] * 1000) + "<br/>指数:<b>" + fmtPx(v) + "</b> · 稳定性带 ± $" + b.toFixed(2) +
            "<br/>区间:" + fmtPx(Math.max(0, v - b)) + " – " + fmtPx(v + b);
        },
      },
      xAxis: { type: "time", axisLine: { lineStyle: { color: "#ddd" } }, axisLabel: { color: "#8a8a8a", fontSize: 11 } },
      yAxis: {
        type: "value", scale: true, splitLine: { lineStyle: { color: "#f0f0f0" } },
        axisLabel: { color: "#8a8a8a", fontSize: 11, formatter: (v) => "$" + v.toFixed(1) },
      },
      series: [
        { name: "下界", type: "line", data: lower, stack: "band", silent: true, symbol: "none", lineStyle: { opacity: 0 }, emphasis: { disabled: true }, tooltip: { show: false } },
        { name: "稳定性带", type: "line", data: bandH, stack: "band", silent: true, symbol: "none",
          lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(14,107,79,0.10)" }, emphasis: { disabled: true }, tooltip: { show: false } },
        { name: "指数", type: "line", data: line, symbol: "none", connectNulls: true,
          lineStyle: { color: "#0e6b4f", width: 2 }, emphasis: { lineStyle: { width: 2.6 } },
          markLine: {
            silent: true, symbol: "none",
            lineStyle: { color: "#111", type: "dashed", width: 1 },
            label: { formatter: "今日指数 " + fmtPx(curVal), position: "insideEndTop", color: "#111", fontSize: 11 },
            data: [{ xAxis: last[0] * 1000 }],
          } },
      ],
    };
    S.chart.setOption(opt);
    $("chartCap").textContent = DISP[sku].full + " · 虚线标记今日指数 · 历史自 " + fmtDayUTC(view[0][0] * 1000) + " 起(" + view.length + " 个观测点," + (S.range === "90D" ? "实际可用区间" : S.range) + " 视图)";
  } catch (e) {
    console.error("drawChart:", e);
    (window.__errs = window.__errs || []).push("drawChart: " + e.message);
  }
}

function renderChart() { drawChart(); }

/* ---------- 其它 ---------- */
function setLiveDot(ok) {
  $("liveLabel").textContent = ok ? "实时" : "重连中…";
}
function showErr(msg) {
  const el = $("errBox");
  el.style.display = "block";
  el.textContent = msg;
}

function setupEvents() {
  $("rangeTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    document.querySelectorAll("#rangeTabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    S.range = b.dataset.r;
    renderChart();
  });
  document.querySelectorAll(".copy").forEach((b) => {
    b.addEventListener("click", () => {
      const txt = b.dataset.copy || b.previousElementSibling.textContent;
      const done = () => { const old = b.textContent; b.textContent = "已复制 ✓"; setTimeout(() => (b.textContent = old), 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
      else fallbackCopy(txt, done);
    });
  });
  window.addEventListener("resize", () => S.chart && S.chart.resize());
}

function fallbackCopy(txt, done) {
  const ta = document.createElement("textarea");
  ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { prompt("手动复制:", txt); }
  document.body.removeChild(ta);
}

function refreshRepro() {
  const sku = S.sku.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const cmd = "git clone https://github.com/getcomputable/gpu-index\n./reproduce " + sku + " " + today;
  $("reproCmd").textContent = cmd;
  const btn = $("reproCopy");
  btn.dataset.copy = cmd;
  btn.textContent = "复制";
}

/* ---------- 启动 ---------- */
function init() {
  setupEvents();
  refreshRepro();
  renderLanes();
  waitEcharts(drawChart);
  refreshLive();
  loadSnapshot();
  setInterval(refreshLive, 60000);       // 实时卡片 60s
  setInterval(() => { loadSnapshot(); refreshRepro(); }, 5 * 60000); // 历史快照 5 分钟重读
}
document.addEventListener("DOMContentLoaded", init);
