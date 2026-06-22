// Simpel service worker: cacher app-skallen, så appen kan åbnes uden net.
// Kortfliser, ruter og "i nærheden" kræver dog internet.
const CACHE = "dk100-v3";
const SHELL = [
  "./",
  "./index.html",
  "./src/styles.css",
  "./src/app.js",
  "./src/config.js",
  "./data/places.json",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Kun håndtér vores egne filer (samme origin). Eksterne API'er/fliser går altid til nettet.
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  // Netværk-først: hent friske filer når der er net, og opdatér cachen.
  // Falder tilbage til cache (offline). Sikrer at opdateringer altid slår igennem.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("./index.html")))
  );
});
