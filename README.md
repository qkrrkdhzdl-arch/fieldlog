# FieldLog — the safety log you can write where there is no signal

A construction site's safety supervisor writes down what is wrong while walking the site:
a missing guardrail on the third-floor scaffold, water standing in the sump, a cable
crossing the access path. The signal is usually gone exactly there — the basement, the
stair core, the steel frame. So the note is written on paper, and the formal 일지 (daily
safety log) is typed hours later from memory, or not at all.

FieldLog does three things, and it does the first where the supervisor is standing:

1. **Capture** a one-line finding (typed, or dictated in Korean with the browser's speech
   recognition).
2. **Judge** it — risk level, the one thing to do now, the words that made the model say so.
   With `PREFER_ON_DEVICE`, that judgement runs on **Gemini Nano in the browser** and never
   leaves the device; if the on-device model is not available, Firebase AI Logic falls back
   to **Gemini Flash in the cloud** and the entry is processed anyway.
3. **Draft the daily log** from the recorded entries — on the device when it can, in the
   cloud when it cannot — with a rule that forbids inventing names, numbers, or dates.

Built for the **#BuildHybridAI 2026** hackathon (Firebase AI Logic, hybrid inference), 2026-11-17.

## Why hybrid, specifically here

* **No signal is the normal case, not the error case.** A basement level with no bars is the
  room where the finding happens. An app that needs the cloud to classify "안전난간 미설치"
  is an app that fails where it is needed.
* **The notes are about people.** "작업자 2명 접근" plus a location is enough to identify who
  was where. Judging on the device means the sentence is not sent anywhere to be triaged.
* **The cloud is genuinely better at the report.** Turning eight terse notes into a log that
  a site manager will sign is a writing job, and it is worth a bigger model when there is a
  connection.

So the app sets the inference mode per job: capture and judgement prefer the device, the
report prefers whatever is reachable. The screen always says which one answered.

## What the SDK actually does

```js
// ai.js
const model = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });

const result = await model.generateContent(prompt);
result.response.text();
result.response.inferenceSource;   // "ON_DEVICE" | "IN_CLOUD"
```

`inferenceSource` is not decoration: it is stored on every entry, shown as a badge
(`기기 내` / `클라우드`), and printed under the drafted report. When the device cannot answer,
the entry is kept as `대기` in `localStorage`, the header counts it, and the queue is re-tried
on the `online` event.

`initializeDeviceModel()` is called from a button press (Chrome's user-activation rule), and
Settings → "이 기기의 기기 내 모델 확인" tells the user plainly whether this browser has the
on-device model or will fall back.

## Architecture

```
index.html · style.css          one screen, four views, no framework
app.js                          store (localStorage), offline queue, patterns, UI
ai.js                           Firebase init + two prompts (judge, report) + probe
vendor/                         firebase-app / -ai / -app-check 12.5.0, vendored so the
                                shell loads with no network (rewritten to relative imports)
sw.js                           app-shell cache; same-origin only, API calls untouched
```

* Single-turn text generation on both paths — the shape Firebase AI Logic supports on-device.
* The judge returns JSON only, parsed leniently (`parseJsonLoose`) so a stray fence or a
  truncated reply does not lose the entry.
* The report streams (`generateContentStream`) into the textarea, and stays editable.
* Repeating tags across 7 days are counted locally (no model) and become the log's
  "반복 지적" section.

## Privacy and the honest limits

* Entries live in this browser. The only thing sent to the cloud path is the sentence being
  judged, or the entries being drafted into a report.
* The judge prompt forbids inventing people, numbers, times, and equipment, and requires the
  `why` field to quote the words it used. It does not cite 법령 — an invented article number
  is worse than no citation.
* The report is labelled an AI draft: it is meant to be checked against the site before it is
  signed. FieldLog never submits anything on the user's behalf.
* On-device inference needs Chrome desktop 139+ with the Prompt API flag. Everywhere else the
  app is a cloud app, and says so rather than pretending.
* This public demo build uses a Firebase App Check **debug token** (allowed by the hackathon
  rules) instead of a reCAPTCHA site key, so a reviewer can open the page without a key.

## Run it

Static files. Open the GitHub Pages URL, or serve the folder:

```
python3 -m http.server 8000     # then http://localhost:8000
```

First run: press **예시 기록 채우기** for three sample findings, then **일지 → 초안 만들기**.

## What was built during the submission period

Everything: the store and offline queue, both prompts and their parsers, the streaming
report, the pattern counter, the app shell and service worker, the Firebase project
(fieldlog-hybrid, Spark plan), the App Check debug-token setup, the vendored SDK, this README.
The only pre-existing material is the Firebase JS SDK itself (Apache-2.0) and the public
documentation for hybrid inference.

MIT licensed.
