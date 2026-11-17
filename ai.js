// ai.js — Firebase AI Logic (hybrid: Gemini Nano on-device, Gemini Flash in-cloud)
import { initializeApp } from "./vendor/firebase-app.js?v=13";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "./vendor/firebase-ai.js?v=13";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "./vendor/firebase-app-check.js?v=13";

const firebaseConfig = {
  apiKey: "AIzaSyCt2oe086TSZtIUIUHpEkATeffXC5AL3bM",
  authDomain: "fieldlog-hybrid.firebaseapp.com",
  projectId: "fieldlog-hybrid",
  storageBucket: "fieldlog-hybrid.firebasestorage.app",
  messagingSenderId: "986923373372",
  appId: "1:986923373372:web:d53838dde1e105a01c0439"
};

// App Check for the public demo build. A debug token replaces reCAPTCHA so that
// reviewers can run the app without a site key; it attests nothing else.
const APP_CHECK_DEBUG_TOKEN = "0BBF7034-F5EB-4EBE-A885-9D49CF98FC89";

let cached = null;

export function getClient() {
  if (cached) return cached;
  const app = initializeApp(firebaseConfig);

  try {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = APP_CHECK_DEBUG_TOKEN;
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider("6Ld-fieldlog-demo"),
      isTokenAutoRefreshEnabled: false
    });
  } catch (err) {
    console.warn("App Check init:", err?.message || err);
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  cached = { app, ai };
  return cached;
}

// Cloud models. Gemini 2.5 is being retired (2026-12-01 routing), so the app
// pins current models instead of the SDK default.
const CLASSIFY_MODEL = "gemini-3.5-flash-lite";
const REPORT_MODEL = "gemini-3.5-flash-lite";

export function modelFor(mode, modelName = CLASSIFY_MODEL) {
  const { ai } = getClient();
  const inferenceMode = mode === "PREFER_IN_CLOUD" ? InferenceMode.PREFER_IN_CLOUD : InferenceMode.PREFER_ON_DEVICE;
  return getGenerativeModel(ai, {
    mode: inferenceMode,
    inCloudParams: { model: modelName },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["ko", "en"] }],
        expectedOutputs: [{ type: "text", languages: ["ko"] }]
      }
    }
  });
}

/* ── 판정 ─────────────────────────────────────────────────────────────
   One short single-turn request: the same call runs on the device when the
   browser can, and in the cloud when it cannot. The reply is JSON only.  */
const CLASSIFY_RULES = `너는 건설현장 안전점검을 돕는 판정기다.
입력은 현장에서 감독자가 한두 줄로 적은 발견사항이다.
아래 JSON만 출력한다. 설명, 인사, 코드블록 표시를 붙이지 않는다.
{"risk":"상|중|하","action":"감독자가 지금 할 일 한 문장(40자 이내)","tags":["분류어1","분류어2"],"why":"원문의 어느 표현으로 그렇게 판단했는지 한 문장"}

규칙:
- 원문에 없는 사실을 만들지 않는다. 인원, 시간, 장비를 추측해 채우지 않는다.
- 사람이 다치거나 구조물이 무너질 수 있는 상태면 "상", 방치하면 커지는 상태면 "중", 정리 수준이면 "하".
- 확실하지 않으면 "중"으로 두고 why에 무엇이 확인되지 않았는지 적는다.
- tags는 반복 지적을 세기 위한 짧은 명사형으로 2개 이내. 예: "안전난간","전선 노출","적재 불량","통로 적치","보호구","배수".`;

export async function classify(text, chips, mode) {
  const model = modelFor(mode);
  const input = [chips?.length ? `선택한 항목: ${chips.join(", ")}` : "", `발견사항: ${text}`]
    .filter(Boolean).join("\n");

  const result = await model.generateContent(`${CLASSIFY_RULES}\n\n${input}`);
  const source = result.response.inferenceSource || "IN_CLOUD";
  const raw = result.response.text() || "";
  return { ...parseJsonLoose(raw), source, raw };
}

function parseJsonLoose(raw) {
  let s = String(raw).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) {
    return { risk: "MID", action: "", tags: [], why: "", parseError: true };
  }
  s = s.slice(start, end + 1);
  try {
    const o = JSON.parse(s);
    return {
      risk: normalizeRisk(o.risk),
      action: String(o.action || "").trim(),
      tags: Array.isArray(o.tags) ? o.tags.map(String).slice(0, 3) : [],
      why: String(o.why || "").trim()
    };
  } catch {
    const risk = /"risk"\s*:\s*"?(상|중|하)/.exec(s)?.[1];
    return { risk: normalizeRisk(risk), action: "", tags: [], why: "", parseError: true };
  }
}

function normalizeRisk(v) {
  const t = String(v || "").trim();
  if (t.startsWith("상") || /^high$/i.test(t)) return "HIGH";
  if (t.startsWith("하") || /^low$/i.test(t)) return "LOW";
  return "MID";
}

/* ── 일지 초안 (스트리밍) ─────────────────────────────────────────── */
const REPORT_RULES = `너는 건설현장 안전점검 일지 작성 보조다.
아래 '확인된 기록'만 재료로 오늘의 안전점검 일지를 한국어로 쓴다.

형식:
1) 점검 개요 — 날짜, 현장, 점검자, 확인한 기록 수
2) 발견사항 — 기록마다 번호를 붙이고, 원문 표현을 유지한 채 위험도와 조치를 한 줄씩
3) 조치 요청 — 위험도 '상' 항목만 모아 담당과 기한을 제안
4) 반복 지적 — 두 번 이상 나온 항목만

규칙:
- 기록에 없는 내용, 수치, 이름, 날짜를 만들지 않는다. 비어 있으면 "기록 없음"이라고 쓴다.
- '반복 지적'에는 위에 준 목록만 쓴다. 목록이 '없음'이면 "기록 없음"이라고 쓴다.
- 각 줄은 줄바꿈으로 나누고, 번호는 1. 2. 3. 형식으로 쓴다.
- 법령 조항을 인용하지 않는다. 확인되지 않은 규정은 쓰지 않는다.
- '-다' 평서체. 과장 없이. 각 항목은 한두 문장.`;

export async function draftReport({ site, date, entries, mode, onChunk }) {
  const model = modelFor(mode, REPORT_MODEL);
  const lines = entries.map((e, i) =>
    `${i + 1}. [${riskKo(e.risk)}] ${e.text}` +
    (e.tags?.length ? ` (분류: ${e.tags.join(", ")})` : "") +
    (e.action ? ` / 조치 제안: ${e.action}` : "")
  ).join("\n");

  // Repeats are counted here, not by the model, so the section cannot invent them.
  const counts = new Map();
  entries.forEach((e) => (e.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const repeats = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  const repeatLine = repeats.length
    ? repeats.map(([t, n]) => `${t} ${n}회`).join(", ")
    : "없음";

  const prompt = `${REPORT_RULES}\n\n현장: ${site}\n날짜: ${date}\n점검자: 박가온\n확인된 기록 ${entries.length}건:\n${lines || "기록 없음"}\n\n반복 지적(앱이 센 값, 그대로 쓸 것): ${repeatLine}`;

  // One request rather than a stream: hybrid streaming keeps the request open
  // for as long as the on-device model is downloading, and the draft is short.
  const result = await model.generateContent(prompt);
  const text = result.response.text() || "";
  if (onChunk) onChunk(text);
  return { text, source: result.response.inferenceSource || "IN_CLOUD" };
}

export function riskKo(r) {
  return r === "HIGH" ? "상" : r === "LOW" ? "하" : "중";
}

/* ── 기기 내 모델 확인 ───────────────────────────────────────────── */
export async function probeOnDevice() {
  const promptApi = !!(self.LanguageModel || (self.ai && self.ai.languageModel));
  if (!promptApi) {
    return {
      ok: false,
      detail: "이 브라우저에는 Chrome 내장 모델(Prompt API)이 없습니다. Chrome 데스크톱 139 이상에서 기기 내 판정이 켜집니다."
    };
  }
  const model = modelFor("PREFER_ON_DEVICE");
  if (typeof model.initializeDeviceModel !== "function") {
    return { ok: false, detail: "이 SDK 버전은 기기 내 추론을 노출하지 않습니다." };
  }
  try {
    await Promise.race([
      model.initializeDeviceModel((p) => { if (typeof p === "number") console.log(`on-device model ${Math.round(p * 100)}%`); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("20초 안에 모델이 준비되지 않았습니다")), 20000))
    ]);
  } catch (err) {
    return { ok: false, detail: `기기 내 모델을 준비하지 못했습니다: ${err?.message || err}` };
  }
  try {
    const r = await model.generateContent("한 단어로만 답하시오: 준비");
    return { ok: r.response.inferenceSource === "ON_DEVICE", detail: `${r.response.inferenceSource}` };
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
}
