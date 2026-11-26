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
  if (page !== "darkmode") {
    clearTimeout(darkScheduleRefreshTimer);
    darkScheduleRefreshTimer = 0;
  }
  if (page === "darkmode") loadDarkMode();
  if (page === "nocookie") loadNoCookie();
  if (page === "jsonformat") loadJsonFormat();
  if (page === "keynav") loadKeynav();
  if (page === "gmailfix") loadGmailFix();
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
// "All sites" (darkmode_global) is the default for every site: false (Off),
// "auto" (Prague sunset to 1h after sunrise), or true (On). It inverts only
// the pages that a check calls light. The big switch is manual and for the
// current site only (darkmode_<host>): ON always inverts, OFF never does. It
// overrides "All sites" and stays saved until "Follow all sites" removes it.
const darkToggle = document.getElementById("darkToggle");
const darkStatus = document.getElementById("darkStatus");
const darkHostEl = document.getElementById("darkHost");
const darkBrightness = document.getElementById("darkBrightness");
const darkBrightnessVal = document.getElementById("darkBrightnessVal");
const darkGlobalModeEl = document.getElementById("darkGlobalMode");
const darkGlobalButtons = darkGlobalModeEl.querySelectorAll("button[data-mode]");
const darkGlobalSub = document.getElementById("darkGlobalSub");
const darkScheduleStatus = document.getElementById("darkScheduleStatus");
const darkOverrideLabel = document.getElementById("darkOverrideLabel");
const darkOverrideSub = document.getElementById("darkOverrideSub");
const darkClearSite = document.getElementById("darkClearSite");

let darkHost = "";
let darkScheduleRefreshTimer = 0;

function darkSiteKey() {
  return "darkmode_" + darkHost;
}

function normalizeGlobalMode(value) {
  if (value === true) return "on";
  if (value === "auto") return "auto";
  return "off";
}

function globalModeToStorage(mode) {
  if (mode === "on") return true;
  if (mode === "auto") return "auto";
  return false;
}

function updateDarkGlobalUI(mode, scheduleState) {
  darkGlobalButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", String(active));
  });

  clearTimeout(darkScheduleRefreshTimer);
  darkScheduleRefreshTimer = 0;

  if (mode === "auto") {
    const s = scheduleState;
    const startStr = darkmodeSchedule.formatPragueTime(s.darkStart);
    const endStr = darkmodeSchedule.formatPragueTime(s.darkEnd);
    const nextStr = darkmodeSchedule.formatPragueTime(s.nextChange);
    darkGlobalSub.textContent = "Prague daylight: ON at sunset, OFF 1h after sunrise.";
    darkScheduleStatus.hidden = false;
    darkScheduleStatus.innerHTML = s.isDark
      ? `<span class="state-on">ON now</span> · turns OFF at ${nextStr} (dark ${startStr}–${endStr})`
      : `<span class="state-off">OFF now</span> · turns ON at ${nextStr} (dark ${startStr}–${endStr})`;

    // Refresh live if the popup stays open across sunset or sunrise + 1h.
    const delay = Math.max(1000, Math.min(s.nextChange - Date.now() + 500, 60 * 60 * 1000));
    darkScheduleRefreshTimer = setTimeout(loadDarkMode, delay);
  } else if (mode === "on") {
    darkGlobalSub.textContent = "On for every site. The switch above overrides it for this site.";
    darkScheduleStatus.hidden = true;
    darkScheduleStatus.textContent = "";
  } else {
    darkGlobalSub.textContent = "Off by default. The switch above overrides it for this site.";
    darkScheduleStatus.hidden = true;
    darkScheduleStatus.textContent = "";
  }
}

async function loadDarkMode() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  darkHost = "";
  if (tab && tab.url && !/^(chrome|edge|about|chrome-extension|view-source):/.test(tab.url)) {
    try { darkHost = new URL(tab.url).hostname; } catch { darkHost = ""; }
  }
  darkHostEl.textContent = darkHost ? `This site: ${darkHost}` : "Not a regular web page";
  darkToggle.disabled = !darkHost;

  const keys = ["darkmode_global", "darkmode_brightness"];
  if (darkHost) keys.push(darkSiteKey());
  const data = await chrome.storage.local.get(keys);

  const brightness = data.darkmode_brightness || 100;
  darkBrightness.value = brightness;
  darkBrightnessVal.textContent = brightness + "%";

  const siteState = darkHost ? data[darkSiteKey()] : undefined;
  const globalMode = normalizeGlobalMode(data.darkmode_global);
  const scheduleState = globalMode === "auto" ? darkmodeSchedule.getState() : null;
  const globalDark =
    globalMode === "on" ? true :
    globalMode === "auto" ? scheduleState.isDark :
    false;

  // The switch shows if the page is inverted now, so one click flips what the
  // user sees. With no saved choice and "All sites" on, only the page knows:
  // the check leaves a page alone that it calls dark. If the check is wrong
  // (a white page), the switch shows OFF, and one click forces it ON.
  let enabled = siteState !== undefined ? siteState : globalDark;
  let alreadyDark = false;
  if (darkHost && siteState === undefined && globalDark) {
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: "darkmode_state" });
      if (state) enabled = state.inverted;
      alreadyDark = !enabled;
    } catch {
      // No content script in this tab (a page opened before the install).
    }
  }

  darkToggle.checked = enabled;
  updateDarkStatus(enabled);
  updateDarkGlobalUI(globalMode, scheduleState);
  updateDarkOverrideRow(siteState, globalMode, globalDark, alreadyDark);
}

function updateDarkOverrideRow(siteState, globalMode, globalDark, alreadyDark) {
  darkOverrideLabel.textContent = darkHost || "This site";
  darkClearSite.disabled = !darkHost || siteState === undefined;
  if (!darkHost) {
    darkOverrideSub.textContent = "Open a website to set a per-site override";
  } else if (siteState !== undefined) {
    darkOverrideSub.textContent = `Saved: always ${siteState ? "ON" : "OFF"} on this site`;
  } else if (globalMode === "auto") {
    darkOverrideSub.textContent = `Following All sites (Auto · currently ${globalDark ? "ON" : "OFF"})`;
  } else {
    darkOverrideSub.textContent = `Following All sites (${globalDark ? "ON" : "OFF"})`;
  }
  if (alreadyDark) darkOverrideSub.textContent += ". This page looks dark, so it is not inverted.";
}

function updateDarkStatus(on) {
  darkStatus.textContent = on ? "ON" : "OFF";
  darkStatus.className = "status " + (on ? "on" : "off");
}

// The big switch: saves ON or OFF for the current site only.
// Content scripts react via chrome.storage.onChanged — no messaging needed.
async function applyDark() {
  if (!darkHost) return;
  const enabled = darkToggle.checked;
  const brightness = parseInt(darkBrightness.value);
  updateDarkStatus(enabled);
  await chrome.storage.local.set({ [darkSiteKey()]: enabled, darkmode_brightness: brightness });
  updateDarkOverrideRow(enabled);
}

darkToggle.addEventListener("change", applyDark);

// "All sites" (Off / Auto / On). The old separate "darkmode_auto" key is
// migrated into darkmode_global by background.js.
darkGlobalButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    await chrome.storage.local.set({ darkmode_global: globalModeToStorage(btn.dataset.mode) });
    await loadDarkMode();
  });
});

darkClearSite.addEventListener("click", async () => {
  if (!darkHost) return;
  await chrome.storage.local.remove(darkSiteKey());
  await loadDarkMode();
});

darkBrightness.addEventListener("input", () => {
  darkBrightnessVal.textContent = darkBrightness.value + "%";
});
// Not applyDark: that saves the ON/OFF state for this site, so a brightness
// change would pin the site and it would stop following "All sites".
darkBrightness.addEventListener("change", async () => {
  await chrome.storage.local.set({ darkmode_brightness: parseInt(darkBrightness.value) });
});

// ═══════════════════════════════════
//  Cookie Banner Dismisser
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
//  Gmail Yellow Importance Marker
// ═══════════════════════════════════
const gmailfixToggle = document.getElementById("gmailfixToggle");
const gmailfixStatus = document.getElementById("gmailfixStatus");

async function loadGmailFix() {
  const data = await chrome.storage.local.get(["gmailfix_enabled"]);
  const enabled = data.gmailfix_enabled !== false;
  gmailfixToggle.checked = enabled;
  updateGmailFixUI(enabled);
}

function updateGmailFixUI(on) {
  gmailfixStatus.textContent = on ? "ON" : "OFF";
  gmailfixStatus.className = "status " + (on ? "on" : "off");
}

gmailfixToggle.addEventListener("change", async () => {
  const enabled = gmailfixToggle.checked;
  updateGmailFixUI(enabled);
  // Content script reacts via chrome.storage.onChanged — no messaging needed.
  await chrome.storage.local.set({ gmailfix_enabled: enabled });
});

// ═══════════════════════════════════
//  Keyboard Link Hints
// ═══════════════════════════════════
const keynavToggle = document.getElementById("keynavToggle");
const keynavStatus = document.getElementById("keynavStatus");
const knExclude = document.getElementById("knExclude");
const knSave = document.getElementById("knSave");
const knStatus = document.getElementById("knStatus");
const knCurrentLabel = document.getElementById("knCurrentLabel");
const knCurrentSub = document.getElementById("knCurrentSub");
const knAddCurrent = document.getElementById("knAddCurrent");

const KN_EXCLUDE_KEY = "keynav_exclude";
let knCurrentDomain = ""; // registrable domain of the active tab

async function loadKeynav() {
  const data = await chrome.storage.local.get(["keynav_enabled", KN_EXCLUDE_KEY]);
  const enabled = data.keynav_enabled !== false;
  keynavToggle.checked = enabled;
  updateKeynavUI(enabled);

  const list = Array.isArray(data[KN_EXCLUDE_KEY]) ? data[KN_EXCLUDE_KEY] : [];
  knExclude.value = list.join("\n");
  knStatus.textContent = "";
  await refreshKnCurrent(list);
}

function updateKeynavUI(on) {
  keynavStatus.textContent = on ? "ON" : "OFF";
  keynavStatus.className = "status " + (on ? "on" : "off");
}

async function refreshKnCurrent(list) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try { host = tab && tab.url ? new URL(tab.url).hostname : ""; } catch {}
  if (!host || /^(chrome|edge|about|chrome-extension|view-source|file):/.test(tab && tab.url || "")) {
    knCurrentDomain = "";
    knCurrentLabel.textContent = "Current site";
    knCurrentSub.textContent = "Not a regular web page";
    knAddCurrent.disabled = true;
    knAddCurrent.textContent = "Disable here";
    return;
  }
  knCurrentDomain = registrableDomain(host);
  knCurrentLabel.textContent = host;
  knCurrentSub.textContent = `Will add: ${knCurrentDomain}`;
  if (isCoveredBy(host, list)) {
    knAddCurrent.disabled = true;
    knAddCurrent.textContent = "Already disabled";
  } else {
    knAddCurrent.disabled = false;
    knAddCurrent.textContent = "Disable here";
  }
}

async function saveKeynavExclude() {
  const list = parseWhitelist(knExclude.value);
  await chrome.storage.local.set({ [KN_EXCLUDE_KEY]: list });
  knExclude.value = list.join("\n");
  knStatus.textContent = "Saved.";
  await refreshKnCurrent(list);
}

keynavToggle.addEventListener("change", async () => {
  const enabled = keynavToggle.checked;
  updateKeynavUI(enabled);
  // Content scripts react via chrome.storage.onChanged — no messaging needed.
  await chrome.storage.local.set({ keynav_enabled: enabled });
});

knSave.addEventListener("click", saveKeynavExclude);

knAddCurrent.addEventListener("click", async () => {
  if (!knCurrentDomain) return;
  const list = parseWhitelist(knExclude.value);
  if (!list.includes(knCurrentDomain)) list.push(knCurrentDomain);
  knExclude.value = list.join("\n");
  await saveKeynavExclude();
  knStatus.textContent = `Disabled on ${knCurrentDomain}.`;
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
