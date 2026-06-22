import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

/* =========================================================================
   Konstanter
   ========================================================================= */
const CATEGORIES = {
  slot:         { label: "Slot",        emoji: "🏰", color: "#7c3aed" },
  kirke:        { label: "Kirke",       emoji: "⛪", color: "#4f46e5" },
  natur:        { label: "Natur",       emoji: "🌲", color: "#16a34a" },
  museum:       { label: "Museum",      emoji: "🏛️", color: "#ea580c" },
  strand:       { label: "Strand",      emoji: "🏖️", color: "#0891b2" },
  by:           { label: "By",          emoji: "🏘️", color: "#475569" },
  taarn:        { label: "Tårn",        emoji: "🗼", color: "#d97706" },
  forlystelse:  { label: "Forlystelse", emoji: "🎡", color: "#db2777" },
  sevaerdighed: { label: "Seværdighed", emoji: "⭐", color: "#2563eb" },
};
const catOf = (c) => CATEGORIES[c] || CATEGORIES.sevaerdighed;

const POI_TYPES = {
  attraction: { emoji: "🎯", color: "#0f766e", label: "Seværdighed" },
  restaurant: { emoji: "🍽️", color: "#b91c1c", label: "Restaurant" },
  cafe:       { emoji: "☕", color: "#92400e", label: "Café" },
  bakery:     { emoji: "🥐", color: "#a16207", label: "Bageri" },
  bar:        { emoji: "🍺", color: "#7c2d12", label: "Bar/pub" },
  fast_food:  { emoji: "🍔", color: "#c2410c", label: "Fast food" },
};

const OSRM = "https://router.project-osrm.org";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const VISITED_KEY = "dk100.visited";
const CUSTOM_KEY = "dk100.custom";

/* =========================================================================
   Tilstand
   ========================================================================= */
const state = {
  places: [],
  visited: new Set(),
  markers: new Map(),       // id -> Leaflet marker
  filters: { q: "", landsdel: "", status: "all", cats: new Set(Object.keys(CATEGORIES)) },
  poiLayer: null,
  routeLayer: null,
  nearbyTypes: new Set(["attraction", "restaurant", "cafe"]),
  profile: null,            // min profil {user_id, display_name, color, family_id}
  family: null,             // {id, name, join_code}
  members: new Map(),       // user_id -> {name, color, me}
  familyByPlace: new Map(), // place_id -> Set(user_id) — hvem i familien har besøgt
};
let map, supabase = null, user = null;

/* =========================================================================
   Hjælpere
   ========================================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.innerHTML = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

function landsdelOf(place) {
  const parts = (place.region || "").split(",");
  return parts[parts.length - 1].trim() || "Danmark";
}

function haversine(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtDist = (km) => (km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(km < 10 ? 1 : 0) + " km");
function fmtDur(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " t " + (m % 60) + " min";
}

/* =========================================================================
   Lagring (lokalt + valgfri Supabase-sync)
   ========================================================================= */
function loadVisited() {
  try { return new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveVisited() {
  localStorage.setItem(VISITED_KEY, JSON.stringify([...state.visited]));
}
function loadCustom() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]"); }
  catch { return []; }
}
function saveCustom(list) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); }

async function toggleVisited(id) {
  const nowVisited = !state.visited.has(id);
  if (nowVisited) state.visited.add(id); else state.visited.delete(id);
  saveVisited();
  // opdatér familie-overblikket for mig selv med det samme
  if (user) {
    const set = state.familyByPlace.get(id) || new Set();
    if (nowVisited) set.add(user.id); else set.delete(user.id);
    state.familyByPlace.set(id, set);
  }
  updateProgress();
  refreshMarker(id);
  renderPlaceList();
  if (supabase && user) {
    try {
      if (nowVisited) await supabase.from("visits").upsert({ user_id: user.id, place_id: id });
      else await supabase.from("visits").delete().eq("user_id", user.id).eq("place_id", id);
    } catch (e) { console.warn("sync fejlede", e); }
  }
}

const MEMBER_COLORS = ["#c8102e", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#475569"];
const initialsOf = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
function genCode() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// Login er PÅKRÆVET når en backend er sat op (offentlig udgave). På localhost
// kører appen frit, så vi nemt kan arbejde videre uden at logge ind hver gang.
function requireAuth() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return !local && !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function updateAuthGate() {
  const gate = document.getElementById("auth-gate");
  if (!gate) return;
  gate.classList.toggle("hidden", !(requireAuth() && !user));
}

// Login/oprettelse med e-mail + kodeord (ingen e-mails → ingen rate-limit).
async function doAuth(email, password, mode) {
  if (!supabase) return { error: "Indlæser stadig — prøv igen om et øjeblik." };
  if (!email || !password) return { error: "Udfyld både e-mail og kodeord." };
  if (mode === "signup" && password.length < 6) return { error: "Kodeordet skal være mindst 6 tegn." };
  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) return { error: "Den e-mail har allerede en bruger — log ind i stedet.", switchToLogin: true };
      return { error: error.message };
    }
    if (!data.session) return { error: "Bruger oprettet, men e-mail-bekræftelse er slået til i Supabase. Slå 'Confirm email' fra." };
    return { ok: true };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/confirm/i.test(error.message)) return { error: "Brugeren er ikke bekræftet endnu. Slet den i Supabase (Authentication → Users) og opret den igen — nu hvor 'Confirm email' er slået fra." };
    return { error: "Forkert e-mail eller kodeord." };
  }
  return { ok: true };
}

let gateMode = "login";
function setGateMode(mode) {
  gateMode = mode;
  const submit = document.getElementById("gate-submit");
  const toggle = document.getElementById("gate-toggle");
  const hint = document.getElementById("gate-pw-hint");
  if (submit) submit.textContent = mode === "signup" ? "Opret bruger" : "Log ind";
  if (toggle) toggle.innerHTML = mode === "signup"
    ? "Har du allerede en bruger? <a href='#'>Log ind</a>"
    : "Ny her? <a href='#'>Opret bruger</a>";
  if (hint) hint.textContent = mode === "signup" ? "Vælg et kodeord på mindst 6 tegn." : "";
  const msg = document.getElementById("gate-msg");
  if (msg) msg.textContent = "";
  const pw = document.getElementById("gate-password");
  if (pw) pw.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
}

async function gateSubmit() {
  const email = ($("#gate-email").value || "").trim();
  const password = $("#gate-password").value || "";
  $("#gate-msg").textContent = "";
  $("#gate-submit").disabled = true;
  const res = await doAuth(email, password, gateMode);
  $("#gate-submit").disabled = false;
  if (res.error) {
    $("#gate-msg").textContent = res.error;
    if (res.switchToLogin) setGateMode("login");
  }
  // ved succes skjuler onAuthStateChange automatisk login-skærmen
}

async function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { updateFamilyUI(); updateAuthGate(); return; }
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await supabase.auth.getSession();
    user = data.session?.user || null;
    supabase.auth.onAuthStateChange((_e, session) => {
      user = session?.user || null;
      updateFamilyUI();
      updateAuthGate();
      if (user) { bootstrapFamily(); }
      else { state.profile = null; state.family = null; state.members.clear(); state.familyByPlace.clear(); renderPlaceList(); state.markers.forEach((_, id) => refreshMarker(id)); }
    });
    updateFamilyUI();
    updateAuthGate();
    if (user) bootstrapFamily();
  } catch (e) {
    console.warn("Supabase kunne ikke indlæses", e);
    updateFamilyUI();
    updateAuthGate();
  }
}

// Sørg for at jeg har en profil; opret med fornuftige standarder hvis ikke.
async function ensureProfile() {
  let { data: prof } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
  let created = false;
  if (!prof) {
    const dn = (user.email || "Mig").split("@")[0];
    const color = MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
    const ins = await supabase.from("profiles").insert({ user_id: user.id, display_name: dn, color }).select().single();
    prof = ins.data;
    created = true;
  }
  state.profile = prof;
  if (created) setTimeout(openWelcome, 400); // ny bruger: byd velkommen + lad dem vælge navn/farve
  return prof;
}

function openWelcome() {
  openModal("Velkommen! 🇩🇰", `
    <p class="hint">Hvad skal vi kalde dig? Navnet vises ved de steder du krydser af, hvis du er med i en familie.</p>
    <label>Dit navn</label>
    <input id="wel-name" type="text" value="${state.profile?.display_name || ""}" />
    <label>Din farve</label>
    <select id="wel-color" class="color-select">${MEMBER_COLORS.map((c) => `<option value="${c}" ${c === state.profile?.color ? "selected" : ""} style="color:${c}">●●●</option>`).join("")}</select>`,
    async () => { await updateMyProfile(($("#wel-name").value || "").trim() || state.profile.display_name, $("#wel-color").value); },
    "Kom i gang", false, "Spring over");
}

async function bootstrapFamily() {
  if (!supabase || !user) return;
  try {
    await ensureProfile();
    await syncOwnVisits();
    if (state.profile?.family_id) await loadFamily();
    else buildSoloView();
    updateFamilyUI();
    renderPlaceList();
    state.markers.forEach((_, id) => refreshMarker(id));
  } catch (e) { console.warn("bootstrapFamily", e); }
}

// Flet mine lokale + sky-besøg (uændret princip fra før).
async function syncOwnVisits() {
  const { data, error } = await supabase.from("visits").select("place_id").eq("user_id", user.id);
  if (error) throw error;
  const cloud = new Set(data.map((r) => r.place_id));
  const before = state.visited.size;
  cloud.forEach((id) => state.visited.add(id));
  const toPush = [...state.visited].filter((id) => !cloud.has(id)).map((id) => ({ user_id: user.id, place_id: id }));
  if (toPush.length) await supabase.from("visits").upsert(toPush);
  saveVisited();
  updateProgress();
  if (state.visited.size !== before || toPush.length) toast("☁︎ Synkroniseret");
}

function buildSoloView() {
  state.family = null;
  state.members = new Map([[user.id, { name: state.profile?.display_name || "Mig", color: state.profile?.color || "#c8102e", me: true }]]);
  state.familyByPlace = new Map();
  state.visited.forEach((id) => state.familyByPlace.set(id, new Set([user.id])));
}

async function loadFamily() {
  const famId = state.profile.family_id;
  const [{ data: fam }, { data: members }] = await Promise.all([
    supabase.from("families").select("*").eq("id", famId).maybeSingle(),
    supabase.from("profiles").select("user_id,display_name,color").eq("family_id", famId),
  ]);
  state.family = fam;
  state.members = new Map((members || []).map((m) => [m.user_id, { name: m.display_name, color: m.color, me: m.user_id === user.id }]));
  const ids = [...state.members.keys()];
  const { data: visits } = await supabase.from("visits").select("user_id,place_id").in("user_id", ids.length ? ids : ["_"]);
  const byPlace = new Map();
  (visits || []).forEach((v) => { const s = byPlace.get(v.place_id) || new Set(); s.add(v.user_id); byPlace.set(v.place_id, s); });
  state.familyByPlace = byPlace;
  subscribeRealtime();
}

let _rtChannel = null;
function subscribeRealtime() {
  if (_rtChannel || !supabase) return;
  try {
    _rtChannel = supabase.channel("dk100-visits")
      .on("postgres_changes", { event: "*", schema: "public", table: "visits" }, () => {
        if (state.profile?.family_id) loadFamily().then(() => { renderPlaceList(); state.markers.forEach((_, id) => refreshMarker(id)); });
      }).subscribe();
  } catch { /* realtime evt. ikke aktiveret — det er fint */ }
}

async function createFamily(name) {
  const { data: fam, error } = await supabase.from("families").insert({ name: name || "Vores familie", join_code: genCode() }).select().single();
  if (error) { toast("Kunne ikke oprette familie: " + error.message); return; }
  await supabase.from("profiles").update({ family_id: fam.id }).eq("user_id", user.id);
  state.profile.family_id = fam.id;
  await bootstrapFamily();
  toast("Familie oprettet 🎉");
  openFamilyModal();
}

async function joinFamily(code) {
  const c = (code || "").trim().toUpperCase();
  if (!c) return;
  const { data: fam } = await supabase.from("families").select("id").eq("join_code", c).maybeSingle();
  if (!fam) { toast("Ingen familie med den kode"); return; }
  await supabase.from("profiles").update({ family_id: fam.id }).eq("user_id", user.id);
  state.profile.family_id = fam.id;
  await bootstrapFamily();
  toast("Du er med i familien 🎉");
  openFamilyModal();
}

async function leaveFamily() {
  await supabase.from("profiles").update({ family_id: null }).eq("user_id", user.id);
  state.profile.family_id = null;
  await bootstrapFamily();
  toast("Du har forladt familien");
}

async function updateMyProfile(name, color) {
  const dn = name || "Mig";
  await supabase.from("profiles").update({ display_name: dn, color }).eq("user_id", user.id);
  state.profile.display_name = dn; state.profile.color = color;
  state.members.set(user.id, { name: dn, color, me: true });
  updateFamilyUI(); renderPlaceList(); toast("Gemt");
}

function updateFamilyUI() {
  const btn = $("#sync-btn");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { btn.textContent = "👪 Familie"; return; }
  if (!user) { btn.textContent = "👪 Log ind"; return; }
  btn.textContent = "👪 " + (state.family ? state.family.name : (state.profile?.display_name || "Familie"));
}

// Initial-badges for ANDRE familiemedlemmer der har besøgt (mit eget vises via fluebenet).
function memberBadgesHtml(placeId) {
  if (!state.family) return "";
  const set = state.familyByPlace.get(placeId);
  if (!set) return "";
  const others = [...set].filter((uid) => uid !== user?.id).map((uid) => state.members.get(uid)).filter(Boolean);
  if (!others.length) return "";
  const shown = others.slice(0, 4).map((m) => `<span class="mbadge" style="background:${m.color}" title="${m.name}">${initialsOf(m.name)}</span>`).join("");
  const extra = others.length > 4 ? `<span class="mbadge more">+${others.length - 4}</span>` : "";
  return `<span class="mbadges">${shown}${extra}</span>`;
}

function familyPopupHtml(placeId) {
  if (!state.family) return "";
  const set = state.familyByPlace.get(placeId);
  if (!set || !set.size) return `<div class="popup-fam muted">Ingen i familien har været her endnu</div>`;
  const names = [...set].map((uid) => { const m = state.members.get(uid); return m ? (uid === user?.id ? "dig" : m.name) : null; }).filter(Boolean);
  return `<div class="popup-fam">👪 Besøgt af: ${names.join(", ")}</div>`;
}

function onSyncClick() { openFamilyModal(); }

function openFamilyModal() {
  // 1) backend ikke sat op
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    openModal("Del med familien", `
      <p class="hint">Lige nu gemmes dine afkrydsninger kun lokalt i denne browser.</p>
      <p class="hint">For at I kan dele (login + fælles familie-kort), skal appen kobles til en gratis backend:
      opret et projekt på <b>supabase.com</b>, kør SQL'en i <b>supabase-setup.sql</b>, og indsæt URL + anon-nøgle
      i <code>src/config.js</code>. Hele guiden står i <b>README.md</b>.</p>`,
      null, "Forstået", true);
    return;
  }
  // 2) ikke logget ind
  if (!user) {
    openModal("Log ind", `
      <label>E-mail</label>
      <input id="fl-email" type="email" placeholder="din@email.dk" />
      <label>Kodeord</label>
      <input id="fl-pass" type="password" placeholder="mindst 6 tegn" />
      <p id="fl-msg" class="note"></p>
      <button id="fl-login" class="primary-btn" style="width:100%;margin-top:8px">Log ind</button>
      <p class="note" style="margin-top:10px">Ny her? <a href="#" id="fl-signup">Opret bruger</a></p>`,
      null, "Luk", true, "Luk");
    const go = async (mode) => {
      const r = await doAuth(($("#fl-email").value || "").trim(), $("#fl-pass").value || "", mode);
      if (r.error) $("#fl-msg").textContent = r.error; else closeModal();
    };
    $("#fl-login").onclick = () => go("login");
    $("#fl-signup").onclick = (e) => { e.preventDefault(); go("signup"); };
    return;
  }
  // 3) logget ind, men ingen familie endnu
  if (!state.family) {
    openModal("Familie", `
      <p class="hint">Logget ind som <b>${state.profile?.display_name || user.email}</b>.</p>
      <label>Opret en ny familie</label>
      <input id="fam-name" type="text" placeholder="Fx Familien Rønnau" />
      <button id="fam-create" class="primary-btn" style="width:100%;margin-top:8px">Opret familie</button>
      <label style="margin-top:18px">…eller deltag med en kode</label>
      <div style="display:flex;gap:8px">
        <input id="fam-code" type="text" placeholder="6-tegns kode" style="text-transform:uppercase" />
        <button id="fam-join" class="ghost-btn">Deltag</button>
      </div>
      <p class="note" style="margin-top:16px"><a href="#" id="fam-signout">Log ud</a></p>`,
      null, "Luk", true, "Luk");
    $("#fam-create").onclick = () => createFamily($("#fam-name").value.trim());
    $("#fam-join").onclick = () => joinFamily($("#fam-code").value);
    $("#fam-signout").onclick = (e) => { e.preventDefault(); supabase.auth.signOut(); closeModal(); };
    return;
  }
  // 4) i en familie: kode til deling + medlems-oversigt + min profil
  renderFamilyPanel();
}

function renderFamilyPanel() {
  const total = state.places.length;
  const rows = [...state.members.entries()].map(([uid, m]) => {
    let cnt = 0; state.familyByPlace.forEach((set) => { if (set.has(uid)) cnt++; });
    const pct = total ? Math.round((cnt / total) * 100) : 0;
    return `<div class="fam-row">
      <span class="mbadge" style="background:${m.color}">${initialsOf(m.name)}</span>
      <span class="fam-name">${m.name}${m.me ? " (dig)" : ""}</span>
      <span class="fam-count">${cnt}/${total}</span>
      <span class="fam-barwrap"><span class="fam-bar" style="width:${pct}%;background:${m.color}"></span></span>
    </div>`;
  }).join("");
  openModal("👪 " + state.family.name, `
    <p class="hint">Del koden med familien, så de kan logge ind og være med:</p>
    <div class="joincode" id="joincode" title="Klik for at kopiere">${state.family.join_code}</div>
    <div class="fam-list">${rows}</div>
    <label style="margin-top:16px">Mit navn & farve</label>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="me-name" type="text" value="${state.profile?.display_name || ""}" />
      <select id="me-color" class="color-select">${MEMBER_COLORS.map((c) => `<option value="${c}" ${c === state.profile?.color ? "selected" : ""} style="color:${c}">●●●</option>`).join("")}</select>
      <button id="me-save" class="ghost-btn">Gem</button>
    </div>
    <p class="note" style="margin-top:16px"><a href="#" id="fam-leave">Forlad familie</a> · <a href="#" id="fam-signout">Log ud</a></p>`,
    null, "Luk", true, "Luk");
  $("#joincode").onclick = () => { navigator.clipboard?.writeText(state.family.join_code); toast("Kode kopieret"); };
  $("#me-save").onclick = () => updateMyProfile($("#me-name").value.trim(), $("#me-color").value);
  $("#fam-leave").onclick = (e) => { e.preventDefault(); leaveFamily(); closeModal(); };
  $("#fam-signout").onclick = (e) => { e.preventDefault(); supabase.auth.signOut(); closeModal(); };
}

/* =========================================================================
   Kort
   ========================================================================= */
function initMap() {
  map = L.map("map", { zoomControl: true }).setView([56.1, 11.4], 7);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 19, subdomains: "abcd",
  }).addTo(map);
  state.poiLayer = L.layerGroup().addTo(map);
  state.routeLayer = L.layerGroup().addTo(map);
  window.DKMAP = map; window.DKSTATE = state; // til fejlsøgning
}

function placeIcon(place) {
  const c = catOf(place.category);
  const visited = state.visited.has(place.id);
  return L.divIcon({
    className: "",
    html: `<div class="pin ${visited ? "visited" : ""}" style="background:${c.color}"><span>${c.emoji}</span></div>`,
    iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -26],
  });
}

function refreshMarker(id) {
  const m = state.markers.get(id);
  const p = state.places.find((x) => x.id === id);
  if (m && p) { m.setIcon(placeIcon(p)); m.setPopupContent(placePopupHtml(p)); }
}

function placePopupHtml(p) {
  const c = catOf(p.category);
  const visited = state.visited.has(p.id);
  return `
    <div class="popup-title">${c.emoji} ${p.name}</div>
    <div class="popup-meta">${c.label} · ${p.region}</div>
    ${familyPopupHtml(p.id)}
    <div class="popup-actions">
      <button data-act="visit" data-id="${p.id}" class="${visited ? "on" : ""}">${visited ? "✓ Besøgt" : "Markér besøgt"}</button>
      <button data-act="route" data-id="${p.id}">＋ Til rute</button>
      <button data-act="nearby" data-id="${p.id}">I nærheden</button>
    </div>`;
}

function addPlaceMarkers() {
  state.places.forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: placeIcon(p) }).addTo(map);
    m.bindPopup(placePopupHtml(p));
    m.on("popupopen", (e) => {
      const root = e.popup.getElement();
      $$("button[data-act]", root).forEach((b) => b.addEventListener("click", () => handlePopupAction(b.dataset.act, b.dataset.id)));
    });
    state.markers.set(p.id, m);
  });
}

function handlePopupAction(act, id) {
  const p = state.places.find((x) => x.id === id);
  if (act === "visit") { toggleVisited(id).then(() => state.markers.get(id)?.setPopupContent(placePopupHtml(p)).openPopup()); }
  else if (act === "route") { addToRoute(id); }
  else if (act === "nearby") { switchTab("nearby"); $("#nearby-center").value = "map"; map.setView([p.lat, p.lng], 13); findNearby(p); }
}

function focusPlace(id) {
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  map.setView([p.lat, p.lng], 13, { animate: true });
  state.markers.get(id)?.openPopup();
  if (window.innerWidth <= 760) $("#sidebar").classList.remove("open");
}

/* =========================================================================
   Steder-panel
   ========================================================================= */
function buildFilters() {
  const sel = $("#region-filter");
  const landsdele = [...new Set(state.places.map(landsdelOf))].sort();
  landsdele.forEach((l) => { const o = document.createElement("option"); o.value = l; o.textContent = l; sel.appendChild(o); });

  const chips = $("#category-chips");
  Object.entries(CATEGORIES).forEach(([key, c]) => {
    const b = document.createElement("button");
    b.className = "chip active";
    b.dataset.cat = key;
    b.innerHTML = `${c.emoji} ${c.label}`;
    b.addEventListener("click", () => {
      if (state.filters.cats.has(key)) { state.filters.cats.delete(key); b.classList.remove("active"); }
      else { state.filters.cats.add(key); b.classList.add("active"); }
      renderPlaceList();
    });
    chips.appendChild(b);
  });
}

function visiblePlaces() {
  const f = state.filters;
  return state.places.filter((p) => {
    if (f.q && !p.name.toLowerCase().includes(f.q)) return false;
    if (f.landsdel && landsdelOf(p) !== f.landsdel) return false;
    if (!f.cats.has(p.category)) return false;
    const v = state.visited.has(p.id);
    if (f.status === "done" && !v) return false;
    if (f.status === "todo" && v) return false;
    return true;
  });
}

function renderPlaceList() {
  const list = $("#place-list");
  const items = visiblePlaces().sort((a, b) => a.name.localeCompare(b.name, "da"));
  if (!items.length) { list.innerHTML = `<div class="empty">Ingen steder matcher filtrene.</div>`; return; }
  list.innerHTML = "";
  items.forEach((p) => {
    const c = catOf(p.category);
    const visited = state.visited.has(p.id);
    const row = document.createElement("div");
    row.className = "place-item" + (visited ? " visited" : "");
    row.innerHTML = `
      <div class="place-check" title="Markér besøgt">${visited ? "✓" : ""}</div>
      <span class="place-dot" style="background:${c.color}"></span>
      <div class="place-body">
        <div class="place-name">${p.name}</div>
        <div class="place-meta">${c.emoji} ${c.label} · ${p.region}</div>
      </div>
      ${memberBadgesHtml(p.id)}
      <button class="place-add" title="Tilføj til rute">＋</button>`;
    $(".place-check", row).addEventListener("click", (e) => { e.stopPropagation(); toggleVisited(p.id); });
    $(".place-add", row).addEventListener("click", (e) => { e.stopPropagation(); addToRoute(p.id); });
    row.addEventListener("click", () => focusPlace(p.id));
    list.appendChild(row);
  });
}

function updateProgress() {
  const total = state.places.length;
  const done = state.places.filter((p) => state.visited.has(p.id)).length;
  $("#progress-fill").style.width = total ? (done / total) * 100 + "%" : "0%";
  $("#progress-label").textContent = `${done} / ${total}`;
}

/* =========================================================================
   Rute (OSRM)
   ========================================================================= */
function optionsHtml(selectedId) {
  let html = `<option value="">— vælg sted —</option><option value="me">🛰️ Min placering</option>`;
  state.places.slice().sort((a, b) => a.name.localeCompare(b.name, "da")).forEach((p) => {
    html += `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${p.name}</option>`;
  });
  return html;
}
function populateRouteSelects() {
  $("#route-start").innerHTML = optionsHtml();
  $("#route-end").innerHTML = optionsHtml();
}
function addWaypointRow(selectedId = "") {
  const wrap = $("#route-waypoints");
  const row = document.createElement("div");
  row.className = "waypoint-row";
  row.innerHTML = `<select class="full-select wp-select">${optionsHtml(selectedId)}</select><button class="remove-wp" title="Fjern stop">✕</button>`;
  $(".remove-wp", row).addEventListener("click", () => row.remove());
  wrap.appendChild(row);
  return $(".wp-select", row);
}

function addToRoute(id) {
  if (!$("#route-start").value) { $("#route-start").value = id; toast("Sat som start"); }
  else if (!$("#route-end").value) { $("#route-end").value = id; toast("Sat som slut"); }
  else { addWaypointRow(id); toast("Tilføjet som stop"); }
}

async function resolvePoint(value) {
  if (!value) return null;
  if (value === "me") {
    return new Promise((res, rej) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => res({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: "Min placering" }),
        () => rej(new Error("Kunne ikke hente din placering")), { enableHighAccuracy: true, timeout: 10000 });
    });
  }
  const p = state.places.find((x) => x.id === value);
  return p ? { lat: p.lat, lng: p.lng, name: p.name } : null;
}

async function gatherStops() {
  const ids = [$("#route-start").value, ...$$(".wp-select").map((s) => s.value), $("#route-end").value];
  const stops = [];
  for (const v of ids) { const pt = await resolvePoint(v); if (pt) stops.push(pt); }
  return stops;
}

async function calcRoute() {
  const btn = $("#calc-route");
  let stops;
  try { stops = await gatherStops(); }
  catch (e) { toast(e.message); return; }
  if (stops.length < 2) { toast("Vælg mindst en start og en slut"); return; }
  btn.disabled = true; $("#route-summary").innerHTML = `<span class="spinner"></span> Beregner rute…`;
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  try {
    const url = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&annotations=false`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.code !== "Ok") throw new Error("Ingen rute fundet");
    drawRoute(j.routes[0], stops);
  } catch (e) {
    $("#route-summary").innerHTML = `<span class="hint">Kunne ikke beregne rute: ${e.message}</span>`;
  } finally { btn.disabled = false; }
}

function drawRoute(route, stops) {
  state.routeLayer.clearLayers();
  const line = L.geoJSON(route.geometry, { style: { color: "#c8102e", weight: 5, opacity: 0.85 } }).addTo(state.routeLayer);
  stops.forEach((s, i) => {
    const isFirst = i === 0, isLast = i === stops.length - 1;
    const label = isFirst ? "A" : isLast ? "B" : String(i);
    const color = isFirst ? "#16a34a" : isLast ? "#c8102e" : "#1f2933";
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: "", html: `<div class="pin" style="background:${color}"><span>${label}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26] }),
    }).addTo(state.routeLayer).bindTooltip(s.name);
  });
  map.fitBounds(line.getBounds(), { padding: [50, 50] });

  const km = route.distance / 1000;
  $("#route-summary").innerHTML = `
    <div class="big">${fmtDist(km)} · ${fmtDur(route.duration)}</div>
    <div class="sub">${stops.length} stop · i bil</div>`;
  $("#route-steps").innerHTML = route.legs.map((leg, i) =>
    `<div class="leg"><b>${stops[i].name}</b> → <b>${stops[i + 1].name}</b><br>${fmtDist(leg.distance / 1000)} · ${fmtDur(leg.duration)}</div>`
  ).join("");
}

async function optimizeRoute() {
  let stops;
  try { stops = await gatherStops(); } catch (e) { toast(e.message); return; }
  if (stops.length < 3) { toast("Tilføj mindst ét stop for at optimere"); return; }
  toast("Optimerer rækkefølge…");
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  try {
    const url = `${OSRM}/trip/v1/driving/${coords}?source=first&destination=last&roundtrip=false&overview=full&geometries=geojson`;
    const r = await fetch(url);
    const j = await r.json();
    if (j.code !== "Ok") throw new Error("optimering fejlede");
    // sortér input efter optimeret rækkefølge
    const order = j.waypoints.map((w, idx) => ({ idx, pos: w.waypoint_index })).sort((a, b) => a.pos - b.pos);
    const newStops = order.map((o) => stops[o.idx]);
    // skriv tilbage i UI (start/slut fast, midten ombyttes)
    $("#route-waypoints").innerHTML = "";
    newStops.slice(1, -1).forEach((s) => {
      const match = state.places.find((p) => p.name === s.name);
      addWaypointRow(match ? match.id : "");
    });
    drawRoute(j.trips[0], newStops);
    toast("Rækkefølge optimeret");
  } catch (e) { toast("Kunne ikke optimere: " + e.message); }
}

function clearRoute() {
  state.routeLayer.clearLayers();
  $("#route-waypoints").innerHTML = "";
  $("#route-start").value = ""; $("#route-end").value = "";
  $("#route-summary").innerHTML = ""; $("#route-steps").innerHTML = "";
}

/* =========================================================================
   I nærheden (Overpass)
   ========================================================================= */
function overpassQuery(lat, lng, radiusKm, types) {
  const r = Math.round(radiusKm * 1000);
  const parts = [];
  const add = (sel) => parts.push(`nwr${sel}(around:${r},${lat},${lng});`);
  if (types.has("attraction")) { add(`["tourism"~"attraction|museum|viewpoint|artwork|gallery|zoo|theme_park|castle"]`); add(`["historic"~"castle|monument|memorial|ruins|archaeological_site|church"]`); }
  if (types.has("restaurant")) add(`["amenity"="restaurant"]`);
  if (types.has("cafe")) add(`["amenity"="cafe"]`);
  if (types.has("bakery")) add(`["shop"="bakery"]`);
  if (types.has("bar")) add(`["amenity"~"bar|pub"]`);
  if (types.has("fast_food")) add(`["amenity"="fast_food"]`);
  return `[out:json][timeout:25];(${parts.join("")});out center 80;`;
}

function classifyPoi(tags) {
  if (tags.shop === "bakery") return "bakery";
  if (tags.amenity === "restaurant") return "restaurant";
  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "fast_food") return "fast_food";
  if (tags.amenity === "bar" || tags.amenity === "pub") return "bar";
  return "attraction";
}

async function overpassFetch(query) {
  for (const ep of OVERPASS) {
    try {
      const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(query) });
      if (r.ok) return await r.json();
    } catch { /* prøv næste endpoint */ }
  }
  throw new Error("Overpass svarede ikke");
}

async function findNearby(forcedCenter) {
  const btn = $("#find-nearby");
  const resultsEl = $("#nearby-results");
  let center;
  try {
    if (forcedCenter) center = { lat: forcedCenter.lat, lng: forcedCenter.lng };
    else if ($("#nearby-center").value === "me") {
      center = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => rej(new Error("Ingen placering")), { timeout: 10000 }));
    } else { const c = map.getCenter(); center = { lat: c.lat, lng: c.lng }; }
  } catch (e) { toast(e.message); return; }

  if (!state.nearbyTypes.size) { toast("Vælg mindst én type"); return; }
  const radius = +$("#radius").value;
  btn.disabled = true;
  resultsEl.innerHTML = `<div class="empty"><span class="spinner"></span> Søger inden for ${radius} km…</div>`;
  state.poiLayer.clearLayers();
  L.circle([center.lat, center.lng], { radius: radius * 1000, color: "#c8102e", weight: 1, fillOpacity: 0.04 }).addTo(state.poiLayer);

  try {
    const data = await overpassFetch(overpassQuery(center.lat, center.lng, radius, state.nearbyTypes));
    const items = [];
    for (const el of data.elements) {
      const tags = el.tags || {};
      if (!tags.name) continue;
      const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
      if (lat == null) continue;
      const kind = classifyPoi(tags);
      if (!state.nearbyTypes.has(kind)) continue;
      items.push({ name: tags.name, lat, lng, kind, dist: haversine(center, { lat, lng }), tags });
    }
    items.sort((a, b) => a.dist - b.dist);
    const top = items.slice(0, 60);
    renderNearby(top);
  } catch (e) {
    resultsEl.innerHTML = `<div class="empty">Kunne ikke hente steder: ${e.message}</div>`;
  } finally { btn.disabled = false; }
}

function renderNearby(items) {
  const el = $("#nearby-results");
  if (!items.length) { el.innerHTML = `<div class="empty">Ingen steder fundet. Prøv større radius eller flere typer.</div>`; return; }
  el.innerHTML = "";
  items.forEach((it) => {
    const t = POI_TYPES[it.kind];
    L.marker([it.lat, it.lng], {
      icon: L.divIcon({ className: "", html: `<div class="poi-pin" style="background:${t.color}">${t.emoji}</div>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] }),
    }).addTo(state.poiLayer).bindPopup(`<div class="popup-title">${t.emoji} ${it.name}</div><div class="popup-meta">${t.label} · ${fmtDist(it.dist)} væk</div>`);

    const row = document.createElement("div");
    row.className = "nearby-item";
    const cuisine = it.tags.cuisine ? " · " + it.tags.cuisine.replace(/_/g, " ") : "";
    row.innerHTML = `<div class="nearby-icon">${t.emoji}</div>
      <div class="nearby-body"><div class="nearby-name">${it.name}</div><div class="nearby-sub">${t.label}${cuisine}</div></div>
      <div class="nearby-dist">${fmtDist(it.dist)}</div>`;
    row.addEventListener("click", () => { map.setView([it.lat, it.lng], 15); if (window.innerWidth <= 760) $("#sidebar").classList.remove("open"); });
    el.appendChild(row);
  });
  const heading = document.createElement("div");
  heading.className = "hint";
  heading.style.padding = "8px 4px";
  heading.textContent = `${items.length} steder i nærheden (nærmeste først)`;
  el.prepend(heading);
}

/* =========================================================================
   Tilføj eget sted
   ========================================================================= */
function openAddPlace() {
  const cats = Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.emoji} ${c.label}</option>`).join("");
  openModal("Tilføj eget sted", `
    <label>Navn</label>
    <input id="np-name" type="text" placeholder="F.eks. Hammershus" />
    <label>Kategori</label>
    <select id="np-cat">${cats}</select>
    <label>Landsdel / by</label>
    <input id="np-region" type="text" placeholder="F.eks. Bornholm" />
    <label>Placering</label>
    <button id="np-geocode" class="ghost-btn" style="width:100%">🔎 Find koordinater ud fra navnet</button>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="np-lat" type="number" step="0.000001" placeholder="bredde (lat)" />
      <input id="np-lng" type="number" step="0.000001" placeholder="længde (lng)" />
    </div>
    <p class="note">Tip: lad koordinaterne stå tomme og tryk på knappen, eller udfyld dem selv.</p>`,
    saveNewPlace, "Gem sted");
  $("#np-geocode").addEventListener("click", async () => {
    const q = $("#np-name").value.trim();
    if (!q) { toast("Skriv et navn først"); return; }
    $("#np-geocode").innerHTML = `<span class="spinner"></span> Søger…`;
    const hit = await geocodeName(q, $("#np-region").value.trim());
    $("#np-geocode").innerHTML = "🔎 Find koordinater ud fra navnet";
    if (hit) { $("#np-lat").value = hit.lat.toFixed(6); $("#np-lng").value = hit.lng.toFixed(6); toast("Fundet ✓"); }
    else toast("Ikke fundet — udfyld koordinater manuelt");
  });
}

async function geocodeName(name, region = "") {
  // Nominatim matcher bedst på rene tekstsøgninger; komma-adskilte byer kan fejle.
  // Prøv derfor flere varianter (uden komma) og tag første træf.
  const variants = [name];
  if (region) variants.push(`${name} ${region}`);
  variants.push(`${name} Danmark`);
  for (const q of variants) {
    try {
      const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ q, format: "json", limit: 1, countrycodes: "dk" });
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      const j = await r.json();
      if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon };
    } catch { /* prøv næste variant */ }
  }
  return null;
}

function saveNewPlace() {
  const name = $("#np-name").value.trim();
  const lat = parseFloat($("#np-lat").value), lng = parseFloat($("#np-lng").value);
  if (!name) { toast("Navn mangler"); return false; }
  if (Number.isNaN(lat) || Number.isNaN(lng)) { toast("Koordinater mangler"); return false; }
  const place = {
    id: "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36),
    name, region: $("#np-region").value.trim() || "Eget sted", category: $("#np-cat").value,
    lat, lng, custom: true,
  };
  const custom = loadCustom(); custom.push(place); saveCustom(custom);
  state.places.push(place);
  const m = L.marker([lat, lng], { icon: placeIcon(place) }).addTo(map);
  m.bindPopup(placePopupHtml(place));
  m.on("popupopen", (e) => { const root = e.popup.getElement(); $$("button[data-act]", root).forEach((b) => b.addEventListener("click", () => handlePopupAction(b.dataset.act, b.dataset.id))); });
  state.markers.set(place.id, m);
  populateRouteSelects();
  updateProgress();
  renderPlaceList();
  toast("Sted tilføjet ✓");
  focusPlace(place.id);
  return true;
}

/* =========================================================================
   Modal
   ========================================================================= */
function openModal(title, bodyHtml, onOk, okLabel = "Gem", okOnly = false, cancelLabel = "Annullér") {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  $("#modal-ok").textContent = okLabel;
  $("#modal-cancel").textContent = cancelLabel;
  $("#modal-cancel").style.display = okOnly ? "none" : "";
  $("#modal-backdrop").classList.remove("hidden");
  $("#modal-ok").onclick = async () => {
    if (onOk) { const res = await onOk(); if (res === false) return; }
    closeModal();
  };
}
function closeModal() { $("#modal-backdrop").classList.add("hidden"); }

/* =========================================================================
   Faner
   ========================================================================= */
function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  if (window.innerWidth <= 760) $("#sidebar").classList.add("open");
}

/* =========================================================================
   Init
   ========================================================================= */
async function loadPlaces() {
  let base = [];
  try { base = await (await fetch("./data/places.json")).json(); }
  catch (e) { toast("Kunne ikke indlæse steder — kør appen via en lokal server (se README)"); }
  state.places = [...base, ...loadCustom()];
}

function wireEvents() {
  $("#menu-toggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  $("#search").addEventListener("input", (e) => { state.filters.q = e.target.value.toLowerCase().trim(); renderPlaceList(); });
  $("#region-filter").addEventListener("change", (e) => { state.filters.landsdel = e.target.value; renderPlaceList(); });
  $("#status-filter").addEventListener("change", (e) => { state.filters.status = e.target.value; renderPlaceList(); });

  $("#add-place-btn").addEventListener("click", openAddPlace);
  $("#sync-btn").addEventListener("click", onSyncClick);
  $("#gate-submit").addEventListener("click", gateSubmit);
  $("#gate-toggle").addEventListener("click", (e) => { e.preventDefault(); setGateMode(gateMode === "login" ? "signup" : "login"); });
  $("#gate-email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#gate-password").focus(); });
  $("#gate-password").addEventListener("keydown", (e) => { if (e.key === "Enter") gateSubmit(); });
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "modal-backdrop") closeModal(); });

  $("#add-waypoint").addEventListener("click", () => addWaypointRow());
  $("#calc-route").addEventListener("click", calcRoute);
  $("#optimize-route").addEventListener("click", optimizeRoute);
  $("#clear-route").addEventListener("click", clearRoute);

  $("#radius").addEventListener("input", (e) => { $("#radius-label").textContent = e.target.value + " km"; });
  $("#find-nearby").addEventListener("click", () => findNearby());
  $$("#nearby-types .chip").forEach((chip) => chip.addEventListener("click", () => {
    const t = chip.dataset.type;
    if (state.nearbyTypes.has(t)) { state.nearbyTypes.delete(t); chip.classList.remove("active"); }
    else { state.nearbyTypes.add(t); chip.classList.add("active"); }
  }));
}

async function main() {
  state.visited = loadVisited();
  initMap();
  await loadPlaces();
  addPlaceMarkers();
  if (state.places.length) {
    const b = L.latLngBounds(state.places.map((p) => [p.lat, p.lng]));
    map.fitBounds(b, { padding: [40, 40] });
  }
  buildFilters();
  renderPlaceList();
  populateRouteSelects();
  updateProgress();
  wireEvents();
  setGateMode("login");
  updateAuthGate();   // vis login-skærmen med det samme hvis login er påkrævet
  initSupabase();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

main();
