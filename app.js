// app.js — FieldLog UI, store, offline queue
import { classify, draftReport, probeOnDevice, riskKo } from "./ai.js?v=9";

const CHIPS = ["안전난간", "전선 노출", "적재 불량", "통로 적치", "보호구 미착용", "배수 불량"];
const KEY = "fieldlog.v1";

const $ = (s) => document.querySelector(s);
const state = load();

/* ── 저장 ───────────────────────────── */
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch {}
  if (!s || typeof s !== "object") s = { site: "부산 ○○ 신축공사", mode: "PREFER_ON_DEVICE", entries: [] };
  s.entries ||= [];
  s.mode ||= "PREFER_ON_DEVICE";
  return s;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

/* ── 유틸 ───────────────────────────── */
const fmtTime = (ts) => new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const todayKey = () => new Date().toISOString().slice(0, 10);
const todayEntries = () => state.entries.filter((e) => e.ts.slice(0, 10) === todayKey());

function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

function setPill(el, text, attr, value) {
  el.textContent = text;
  if (attr) el.setAttribute(attr, value);
}

/* ── 연결·엔진 표시 ─────────────────── */
function renderNet() {
  const on = navigator.onLine;
  setPill($("#netPill"), on ? "온라인" : "오프라인", "data-state", on ? "on" : "off");
}
function renderEngine(source) {
  const el = $("#enginePill");
  const map = {
    ON_DEVICE: ["기기에서 판정", "ON_DEVICE"],
    IN_CLOUD: ["클라우드에서 판정", "IN_CLOUD"],
    QUEUED: [`대기 ${queueCount()}건`, "QUEUED"]
  };
  const last = [...state.entries].reverse().find((e) => e.source);
  const fallback = queueCount() ? [`대기 ${queueCount()}건`, "QUEUED"]
    : last ? [`${last.source === "ON_DEVICE" ? "기기에서" : "클라우드에서"} 판정`, last.source]
    : ["기기 확인 중", ""];
  const [text, key] = map[source] || fallback;
  setPill(el, text, "data-src", key);
}
const queueCount = () => state.entries.filter((e) => e.status === "QUEUED").length;

/* ── 화면 ───────────────────────────── */
let activeView = "today";
function showView(name) {
  activeView = name;
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  if (name === "log") renderPatterns();
  if (name === "report") $("#reportDate").textContent = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

function renderChips() {
  const row = $("#chipRow");
  row.innerHTML = "";
  CHIPS.forEach((c) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.textContent = c;
    b.onclick = () => b.classList.toggle("on");
    row.appendChild(b);
  });
}

function itemNode(e, compact = false) {
  const li = document.createElement("li");
  const riskClass = e.status === "QUEUED" ? "queued" : `risk-${e.risk}`;
  li.className = `item ${riskClass}`;
  const judged = e.status !== "QUEUED";
  li.innerHTML = `
    <div class="itemhead">
      <span class="tag ${judged ? riskKo(e.risk) && e.risk : "Q"}">${judged ? "위험 " + riskKo(e.risk) : "대기"}</span>
      ${e.source ? `<span class="tag src">${e.source === "ON_DEVICE" ? "기기 내" : "클라우드"}</span>` : ""}
      <span class="time">${fmtTime(e.ts)}</span>
    </div>
    <div class="quote">${escapeHtml(e.text)}</div>
    ${e.action ? `<div class="action-line">→ ${escapeHtml(e.action)}</div>` : ""}
    ${e.why ? `<div class="why">근거: ${escapeHtml(e.why)}</div>` : ""}
    ${e.status === "QUEUED" && e.error ? `<div class="why err">판정 대기 — ${escapeHtml(e.error.slice(0, 160))}</div>` : ""}
    ${compact ? "" : `<label class="confirm"><input type="checkbox" ${e.confirmed ? "checked" : ""}> 현장에서 확인함</label>`}
  `;
  const box = li.querySelector('input[type="checkbox"]');
  if (box) box.onchange = () => { e.confirmed = box.checked; save(); };
  return li;
}

function renderLists() {
  const today = todayEntries().sort((a, b) => b.ts.localeCompare(a.ts));
  const tl = $("#todayList");
  tl.innerHTML = "";
  today.slice(0, 6).forEach((e) => tl.appendChild(itemNode(e, true)));
  $("#todayEmpty").hidden = today.length > 0;

  const filter = document.querySelector(".fbtn.on")?.dataset.filter || "all";
  const all = [...state.entries].sort((a, b) => b.ts.localeCompare(a.ts))
    .filter((e) => filter === "all" ? true : filter === "high" ? e.risk === "HIGH" && e.status !== "QUEUED" : e.status === "QUEUED");
  const fl = $("#fullList");
  fl.innerHTML = "";
  all.forEach((e) => fl.appendChild(itemNode(e)));

  $("#statCount").textContent = today.length;
  $("#statHigh").textContent = today.filter((e) => e.risk === "HIGH" && e.status !== "QUEUED").length;
  $("#statQueue").textContent = queueCount();
  $("#processBtn").hidden = queueCount() === 0;
}

function renderPatterns() {
  const since = Date.now() - 7 * 864e5;
  const counts = new Map();
  state.entries.filter((e) => new Date(e.ts).getTime() > since).forEach((e) => {
    (e.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
  });
  const rows = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  $("#patternPanel").hidden = rows.length === 0;
  $("#patternNote").textContent = rows.length ? "같은 항목이 다시 나왔습니다. 일지의 '반복 지적'에 그대로 들어갑니다." : "";
  const ul = $("#patternList");
  ul.innerHTML = "";
  rows.forEach(([t, n]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(t)}</span><b>${n}회</b>`;
    ul.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ── 기록 → 판정 ────────────────────── */
async function judge(entry) {
  entry.status = "JUDGING";
  try {
    const out = await classify(entry.text, entry.chips, state.mode);
    Object.assign(entry, { risk: out.risk, action: out.action, tags: out.tags, why: out.why, source: out.source, status: "DONE" });
    renderEngine(out.source);
  } catch (err) {
    entry.status = "QUEUED";
    entry.error = err?.message || String(err);
    renderEngine("QUEUED");
  }
  save();
  renderLists();
  return entry;
}

async function saveEntry(text, chips) {
  const entry = { id: crypto.randomUUID(), ts: new Date().toISOString(), text, chips, status: "QUEUED", error: "" };
  state.entries.push(entry);
  save();
  renderLists();
  await judge(entry);
  if (entry.status === "QUEUED") toast("신호가 없습니다. 기기에 저장했고, 연결되면 판정합니다.", 3200);
}

async function processQueue() {
  const queued = state.entries.filter((e) => e.status === "QUEUED");
  if (!queued.length) return;
  $("#processBtn").disabled = true;
  for (const e of queued) {
    if (!navigator.onLine && state.mode !== "PREFER_ON_DEVICE") continue;
    await judge(e);
  }
  $("#processBtn").disabled = false;
  renderLists();
  toast(queued.every((e) => e.status === "DONE") ? "대기 항목을 판정했습니다." : "아직 판정하지 못한 항목이 있습니다.");
}

/* ── 일지 ───────────────────────────── */
async function makeDraft() {
  const entries = todayEntries().filter((e) => e.status === "DONE");
  if (!entries.length) { toast("오늘 판정된 기록이 없습니다."); return; }
  const btn = $("#draftBtn");
  btn.disabled = true;
  $("#draftSource").textContent = "쓰는 중…";
  const ta = $("#reportText");
  ta.value = "";
  try {
    const { text, source } = await draftReport({
      site: state.site,
      date: new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }),
      entries,
      mode: state.mode,
      onChunk: (partial) => { ta.value = partial; }
    });
    ta.value = text;
    $("#draftSource").textContent = source === "ON_DEVICE"
      ? "이 기기에서 작성 — 문장이 기기를 떠나지 않았습니다."
      : "클라우드에서 작성 — 기기 내 모델을 쓸 수 없어 넘어갔습니다.";
  } catch (err) {
    $("#draftSource").textContent = "초안을 만들지 못했습니다: " + (err?.message || err);
  } finally {
    btn.disabled = false;
  }
}

/* ── 초기화 ─────────────────────────── */
function init() {
  $("#todayLabel").textContent = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  $("#buildInfo").textContent = "build 2026-11-17";
  $("#siteName").value = state.site;
  renderChips();
  renderNet();
  renderEngine();
  renderLists();
  renderPatterns();

  if (state.entries.length) {
    const last = [...state.entries].reverse().find((e) => e.source);
    if (last) renderEngine(last.source === "ON_DEVICE" ? "ON_DEVICE" : "IN_CLOUD");
  }

  window.addEventListener("online", () => { renderNet(); processQueue(); });
  window.addEventListener("offline", () => { renderNet(); renderEngine("QUEUED"); });

  $("#siteName").addEventListener("input", (e) => { state.site = e.target.value; save(); });

  document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => showView(b.dataset.view)));
  document.querySelectorAll(".fbtn").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".fbtn").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    renderLists();
  }));

  $("#captureForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const ta = $("#noteText");
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const chips = [...document.querySelectorAll(".chip.on")].map((c) => c.textContent);
    $("#saveBtn").disabled = true;
    ta.value = "";
    document.querySelectorAll(".chip.on").forEach((c) => c.classList.remove("on"));
    await saveEntry(text, chips);
    $("#saveBtn").disabled = false;
  });

  $("#seedBtn").onclick = async () => {
    const demo = [
      { text: "3층 서측 외부비계 상단 안전난간 미설치, 작업자 2명 접근", chips: ["안전난간"] },
      { text: "지하 1층 집수정 배수 불량으로 물이 고여 있음", chips: ["배수 불량"] },
      { text: "자재 적재 단부에 전선이 노출되어 통행로를 가로지름", chips: ["전선 노출"] }
    ];
    for (const d of demo) await saveEntry(d.text, d.chips);
    toast("예시 기록 3건을 넣었습니다.");
  };

  $("#processBtn").onclick = processQueue;
  $("#draftBtn").onclick = makeDraft;
  $("#copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText($("#reportText").value); toast("복사했습니다."); }
    catch { toast("복사할 수 없습니다. 직접 선택해 주세요."); }
  };
  $("#printBtn").onclick = () => window.print();

  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.checked = r.value === state.mode;
    r.onchange = () => { state.mode = r.value; save(); toast(r.value === "PREFER_IN_CLOUD" ? "클라우드 우선으로 바꿨습니다." : "기기 우선으로 바꿨습니다."); };
  });

  $("#probeBtn").onclick = async () => {
    const out = $("#probeOut");
    out.textContent = "확인 중…";
    const r = await probeOnDevice();
    out.textContent = r.ok ? `기기 내 모델 사용 가능 (${r.detail})` : `이 브라우저에서는 기기 내 모델을 쓸 수 없습니다 — 클라우드로 넘어갑니다. (${r.detail})`;
  };

  $("#exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fieldlog-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $("#clearBtn").onclick = () => {
    if (!confirm("이 현장의 기록을 모두 지웁니다. 되돌릴 수 없습니다.")) return;
    state.entries = [];
    save();
    renderLists(); renderPatterns();
    toast("기록을 지웠습니다.");
  };

  // 음성 입력 (Chrome, 한국어)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#micBtn");
  if (!SR) { mic.hidden = true; }
  else {
    let rec = null;
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = "ko-KR"; rec.interimResults = true; rec.continuous = false;
      mic.classList.add("rec");
      let base = $("#noteText").value;
      rec.onresult = (ev) => {
        let s = "";
        for (const r of ev.results) s += r[0].transcript;
        $("#noteText").value = (base ? base + " " : "") + s;
      };
      rec.onend = () => { mic.classList.remove("rec"); rec = null; };
      rec.onerror = () => { mic.classList.remove("rec"); rec = null; toast("음성 입력을 쓸 수 없습니다."); };
      rec.start();
    };
  }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
