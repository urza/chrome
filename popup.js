// ═══════════════════════════════════
//  Navigation
// ═══════════════════════════════════
function switchToPage(page) {
  document.querySelectorAll(".nav button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  const btn = document.querySelector(`.nav button[data-page="${page}"]`);
  if (!btn) return;
  btn.classList.add("active");
  document.getElementById("page-" + page).classList.add("active");
  if (page === "darkmode") loadDarkMode();
  if (page === "nocookie") loadNoCookie();
  if (page === "jsonformat") loadJsonFormat();
  if (page === "cookieclean") loadCookieClean();
  chrome.storage.local.set({ last_tab: page });
}

document.querySelectorAll(".nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchToPage(btn.dataset.page));
});

// Restore last open tab
chrome.storage.local.get(["last_tab"], (data) => {
  if (data.last_tab) switchToPage(data.last_tab);
  else loadDarkMode();
});

// ═══════════════════════════════════
//  Dark Mode
// ═══════════════════════════════════
const darkToggle = document.getElementById("darkToggle");
const darkStatus = document.getElementById("darkStatus");
const darkHostEl = document.getElementById("darkHost");
const darkBrightness = document.getElementById("darkBrightness");
const darkBrightnessVal = document.getElementById("darkBrightnessVal");
const scopeSite = document.getElementById("scopeSite");
const scopeGlobal = document.getElementById("scopeGlobal");

let darkHost = "";
let darkScope = "site"; // "site" or "global"

async function loadDarkMode() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  try { darkHost = new URL(tab.url).hostname; } catch { darkHost = ""; }
  darkHostEl.textContent = darkHost ? `Current site: ${darkHost}` : "";

  const siteKey = "darkmode_" + darkHost;
  const data = await chrome.storage.local.get([siteKey, "darkmode_global", "darkmode_brightness"]);

  const brightness = data.darkmode_brightness || 100;
  darkBrightness.value = brightness;
  darkBrightnessVal.textContent = brightness + "%";

  const siteState = data[siteKey];
  const globalState = data.darkmode_global || false;
  const enabled = siteState !== undefined ? siteState : globalState;

  darkToggle.checked = enabled;
  updateDarkStatus(enabled);
}

function updateDarkStatus(on) {
  darkStatus.textContent = on ? "ON" : "OFF";
  darkStatus.className = "status " + (on ? "on" : "off");
}

async function applyDark() {
  const enabled = darkToggle.checked;
  const brightness = parseInt(darkBrightness.value);
  updateDarkStatus(enabled);

  // Save preference
  if (darkScope === "global") {
    await chrome.storage.local.set({ darkmode_global: enabled });
  } else {
    const siteKey = "darkmode_" + darkHost;
    await chrome.storage.local.set({ [siteKey]: enabled });
  }
  await chrome.storage.local.set({ darkmode_brightness: brightness });

  // Send to active tab's content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, {
      type: "darkmode_toggle",
      enabled,
      brightness,
    }).catch(() => {});
  }
}

darkToggle.addEventListener("change", applyDark);

darkBrightness.addEventListener("input", () => {
  darkBrightnessVal.textContent = darkBrightness.value + "%";
});
darkBrightness.addEventListener("change", applyDark);

scopeSite.addEventListener("click", () => {
  darkScope = "site";
  scopeSite.classList.add("active");
  scopeGlobal.classList.remove("active");
});
scopeGlobal.addEventListener("click", () => {
  darkScope = "global";
  scopeGlobal.classList.add("active");
  scopeSite.classList.remove("active");
});

// ═══════════════════════════════════
//  Cookie Consent (GDPR) Dismisser
// ═══════════════════════════════════
const nocookieToggle = document.getElementById("nocookieToggle");
const nocookieStatus = document.getElementById("nocookieStatus");

async function loadNoCookie() {
  const data = await chrome.storage.local.get(["nocookie_enabled"]);
  const enabled = data.nocookie_enabled !== false;
  nocookieToggle.checked = enabled;
  updateNoCookieUI(enabled);
}

function updateNoCookieUI(on) {
  nocookieStatus.textContent = on ? "ON" : "OFF";
  nocookieStatus.className = "status " + (on ? "on" : "off");
}

nocookieToggle.addEventListener("change", async () => {
  const enabled = nocookieToggle.checked;
  updateNoCookieUI(enabled);
  await chrome.storage.local.set({ nocookie_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "nocookie_toggle", enabled }).catch(() => {});
  }
});

// ═══════════════════════════════════
//  JSON Formatter
// ═══════════════════════════════════
const jsonformatToggle = document.getElementById("jsonformatToggle");
const jsonformatStatus = document.getElementById("jsonformatStatus");

async function loadJsonFormat() {
  const data = await chrome.storage.local.get(["jsonformat_enabled"]);
  const enabled = data.jsonformat_enabled !== false;
  jsonformatToggle.checked = enabled;
  updateJsonFormatUI(enabled);
}

function updateJsonFormatUI(on) {
  jsonformatStatus.textContent = on ? "ON" : "OFF";
  jsonformatStatus.className = "status " + (on ? "on" : "off");
}

jsonformatToggle.addEventListener("change", async () => {
  const enabled = jsonformatToggle.checked;
  updateJsonFormatUI(enabled);
  await chrome.storage.local.set({ jsonformat_enabled: enabled });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { type: "jsonformat_toggle", enabled }).catch(() => {});
  }
});

// ═══════════════════════════════════
//  Cookie Cleaner
// ═══════════════════════════════════
const ccToggle = document.getElementById("ccToggle");
const ccWhitelist = document.getElementById("ccWhitelist");
const ccSave = document.getElementById("ccSave");
const ccCleanNow = document.getElementById("ccCleanNow");
const ccStatus = document.getElementById("ccStatus");
const ccCurrentLabel = document.getElementById("ccCurrentLabel");
const ccCurrentSub = document.getElementById("ccCurrentSub");
const ccAddCurrent = document.getElementById("ccAddCurrent");

const CC_SETTINGS_KEY = "cookieclean_settings";
const CC_LASTRUN_KEY = "cookieclean_lastrun";

// Two-level public suffixes we want to keep intact when reducing a hostname
// to its registrable domain (so foo.example.co.uk → example.co.uk, not co.uk).
const TWO_LEVEL_TLDS = new Set([
  "co.uk", "co.jp", "co.kr", "co.id", "co.in", "co.nz", "co.za", "co.il",
  "com.au", "com.br", "com.mx", "com.cn", "com.tr", "com.tw", "com.sg",
  "com.hk", "com.ar", "com.pl",
  "ac.uk", "org.uk", "gov.uk", "ne.jp", "or.jp",
]);

function registrableDomain(hostname) {
  const host = hostname.replace(/^\./, "").toLowerCase();
  const parts = host.split(".");
  if (parts.length < 2) return host;
  if (parts.length >= 3) {
    const last2 = parts.slice(-2).join(".");
    if (TWO_LEVEL_TLDS.has(last2)) return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function normalize(d) {
  return (d || "").replace(/^\./, "").toLowerCase().trim();
}

function isCoveredBy(host, whitelist) {
  const h = normalize(host);
  return whitelist.some((entry) => {
    const w = normalize(entry);
    return w && (h === w || h.endsWith("." + w));
  });
}

function parseWhitelist(text) {
  return text
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*\.?/, "").trim().toLowerCase())
    .filter(Boolean);
}

function formatLastRun(run) {
  if (!run || !run.ts) return "No cleanup run yet.";
  const when = new Date(run.ts).toLocaleString();
  return `Last run: <b>${when}</b><br>Removed <b>${run.removed}</b>, kept <b>${run.kept}</b>`;
}

let ccCurrentDomain = ""; // registrable domain of the active tab

async function refreshCurrentSite(whitelist) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { host = tab && tab.url ? new URL(tab.url).hostname : ""; } catch {}
  if (!host || /^(chrome|edge|about|chrome-extension|view-source|file):/.test(tab.url || "")) {
    ccCurrentDomain = "";
    ccCurrentLabel.textContent = "Current site";
    ccCurrentSub.textContent = "Not a regular web page";
    ccAddCurrent.disabled = true;
    ccAddCurrent.textContent = "+ Whitelist";
    return;
  }
  ccCurrentDomain = registrableDomain(host);
  ccCurrentLabel.textContent = host;
  ccCurrentSub.textContent = `Will add: ${ccCurrentDomain}`;
  if (isCoveredBy(host, whitelist)) {
    ccAddCurrent.disabled = true;
    ccAddCurrent.textContent = "Already on list";
  } else {
    ccAddCurrent.disabled = false;
    ccAddCurrent.textContent = "+ Whitelist";
  }
}

async function loadCookieClean() {
  const data = await chrome.storage.local.get([CC_SETTINGS_KEY, CC_LASTRUN_KEY]);
  const s = data[CC_SETTINGS_KEY] || {};
  ccToggle.checked = s.enabled === true;
  const whitelist = Array.isArray(s.whitelist) ? s.whitelist : [];
  ccWhitelist.value = whitelist.join("\n");
  ccStatus.innerHTML = formatLastRun(data[CC_LASTRUN_KEY]);
  await refreshCurrentSite(whitelist);
}

async function saveCookieClean() {
  const settings = {
    enabled: ccToggle.checked,
    whitelist: parseWhitelist(ccWhitelist.value),
  };
  await chrome.storage.local.set({ [CC_SETTINGS_KEY]: settings });
  ccWhitelist.value = settings.whitelist.join("\n");
  ccStatus.innerHTML = "Saved.";
  await refreshCurrentSite(settings.whitelist);
}

ccToggle.addEventListener("change", saveCookieClean);
ccSave.addEventListener("click", saveCookieClean);

ccAddCurrent.addEventListener("click", async () => {
  if (!ccCurrentDomain) return;
  const list = parseWhitelist(ccWhitelist.value);
  if (!list.includes(ccCurrentDomain)) list.push(ccCurrentDomain);
  ccWhitelist.value = list.join("\n");
  await saveCookieClean();
  ccStatus.innerHTML = `Added <b>${ccCurrentDomain}</b> to whitelist.`;
});

ccCleanNow.addEventListener("click", async () => {
  // Save current whitelist first so "clean now" reflects what's on screen.
  await saveCookieClean();
  ccStatus.innerHTML = "Cleaning…";
  chrome.runtime.sendMessage({ type: "cookieclean_now" }, (result) => {
    if (chrome.runtime.lastError || !result) {
      ccStatus.innerHTML = "Cleanup failed.";
      return;
    }
    ccStatus.innerHTML =
      `Removed <b>${result.removed}</b>, kept <b>${result.kept}</b>.`;
  });
});
