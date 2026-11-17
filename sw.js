// sw.js — app shell cache so the form opens with no signal
const CACHE = "fieldlog-v8";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js?v=6",
  "./ai.js?v=5",
  "./manifest.webmanifest",
  "./icon.svg",
  "./vendor/firebase-app.js",
  "./vendor/firebase-ai.js",
  "./vendor/firebase-app-check.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // API calls always go to the network

  // Network first: the app must never show a stale build while online.
  // The cache is the fallback that lets the form open with no signal.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
