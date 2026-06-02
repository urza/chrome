(() => {
  // ──────────────────────────────────────────────────────────────
  //  Keyboard link hints (Vimium-style)
  //
  //  j  → show hints, type the label to click the link in THIS tab
  //  J  → same, but open the link in a NEW tab
  //  Esc / any non-matching key → dismiss
  //
  //  Pure content-script: no extra permissions. Finds visible clickable
  //  elements, overlays short letter labels, simulates the click.
  // ──────────────────────────────────────────────────────────────

  // Right-hand keys only — comfortable to type.
  const HINT_CHARS = "yuiophjklnm";
  const STYLE_ID = "superlevels-keynav-style";
  const OVERLAY_ID = "superlevels-keynav-overlay";

  const CLICKABLE_SELECTOR = [
    "a[href]", "button", "input:not([type=hidden]):not([disabled])",
    "textarea:not([disabled])", "select:not([disabled])",
    "[role=button]", "[role=link]", "[role=menuitem]", "[role=tab]",
    "[onclick]", "summary", "label[for]",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable=true]", "[contenteditable='']",
  ].join(",");

  let enabled = true;       // effective on/off for THIS page
  let globalEnabled = true; // master toggle (popup)
  let excludeList = [];     // domains where the feature is switched off
  let active = false;       // hint overlay currently shown?
  let newTab = false;     // did the user press J (new tab) vs j?
  let markers = [];       // [{ el, label, node }]
  let typed = "";         // keystrokes entered so far

  // ── Visibility ───────────────────────────────────────────────
  function isVisible(el, rect) {
    if (rect.width <= 1 || rect.height <= 1) return false;
    if (rect.bottom < 0 || rect.top > innerHeight) return false;
    if (rect.right < 0 || rect.left > innerWidth) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) {
      return false;
    }
    // Lightweight occlusion check: is the element (or its kin) actually on top
    // at its own centre? Skips things buried under overlays. Lenient: keep the
    // hint if the point is off-screen or the hit-test is inconclusive.
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) return false;
    return true;
  }

  // ── Collect + rank targets (importance: bigger & more central first) ──
  function collectTargets() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(CLICKABLE_SELECTOR)) {
      if (seen.has(el)) continue;
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, rect)) continue;
      seen.add(el);

      // Clamp area so a giant hero banner doesn't dwarf real controls, then
      // bias toward the viewport centre. Highest score → shortest hint.
      const area = Math.min(rect.width * rect.height, 250 * 250);
      const dx = (rect.left + rect.width / 2 - innerWidth / 2) / innerWidth;
      const dy = (rect.top + rect.height / 2 - innerHeight / 2) / innerHeight;
      const centerDist = Math.hypot(dx, dy); // 0 = centre, ~0.7 = corner
      out.push({ el, rect, score: area * (1 - 0.4 * centerDist) });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  // ── Minimal-length, prefix-free hint strings (Vimium's algorithm) ──
  //  Breadth-first expansion of an n-ary tree (n = HINT_CHARS.length): keep
  //  expanding leaves until there are enough, so no hint is a prefix of
  //  another and total length is minimal. We sort SHORTEST-first and hand
  //  them to the importance-ranked targets, so the big/central links get the
  //  single-character labels.
  function hintStrings(count) {
    let hints = [""];
    let offset = 0;
    while (hints.length - offset < count || hints.length === 1) {
      const h = hints[offset++];
      for (const ch of HINT_CHARS) hints.push(h + ch);
    }
    hints = hints.slice(offset, offset + count);
    hints.sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    return hints;
  }

  // ── Overlay rendering ────────────────────────────────────────
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} { all: initial; }
      .slkn-marker {
        position: fixed;
        z-index: 2147483647;
        background: linear-gradient(#fff7c2, #ffd23f);
        color: #2a2200;
        font: bold 11px/1.25 ui-monospace, Menlo, Consolas, monospace;
        padding: 1px 3px;
        border: 1px solid #c79a00;
        border-radius: 3px;
        box-shadow: 0 1px 3px rgba(0,0,0,.45);
        text-transform: uppercase;
        white-space: nowrap;
        pointer-events: none;
        letter-spacing: 1px;
      }
      .slkn-marker .slkn-done { color: #c00; }
      .slkn-marker.slkn-hidden { display: none; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function show() {
    if (active) hide();
    const targets = collectTargets();
    if (!targets.length) return;

    ensureStyle();
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;

    const labels = hintStrings(targets.length);
    markers = targets.map((t, i) => {
      const node = document.createElement("div");
      node.className = "slkn-marker";
      node.textContent = labels[i];
      // Anchor at the element's top-left, nudged inside the viewport.
      node.style.left = Math.max(2, t.rect.left) + "px";
      node.style.top = Math.max(2, t.rect.top) + "px";
      // Important hints (placed first) sit on top, so if two ever still
      // overlap, the shorter/important label stays readable.
      node.style.zIndex = String(2147483647 - i);
      overlay.appendChild(node);
      return { el: t.el, label: labels[i], node };
    });

    (document.body || document.documentElement).appendChild(overlay);
    resolveCollisions(); // measure after the overlay is in the DOM
    active = true;
    typed = "";
    window.addEventListener("scroll", hide, { once: true, passive: true });
  }

  // Nudge overlapping labels apart. Markers are in importance order, so the
  // most important label keeps its spot and crowded neighbours move down (then
  // wrap to the right) until they no longer collide with an already-placed one.
  function resolveCollisions() {
    const placed = [];
    const pad = 1;
    const hits = (a, b) =>
      a.left < b.left + b.w + pad && a.left + a.w + pad > b.left &&
      a.top < b.top + b.h + pad && a.top + a.h + pad > b.top;

    for (const m of markers) {
      const r = m.node.getBoundingClientRect();
      const box = { left: r.left, top: r.top, w: r.width, h: r.height };
      let guard = 0;
      while (guard++ < 40 && placed.some((p) => hits(box, p))) {
        box.top += box.h + pad;
        if (box.top + box.h > innerHeight - 2) {
          box.top = Math.max(2, r.top);
          box.left += box.w + pad;
        }
        if (box.left + box.w > innerWidth - 2) break; // no room — leave it
      }
      m.node.style.left = box.left + "px";
      m.node.style.top = box.top + "px";
      placed.push(box);
    }
  }

  function hide() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    markers = [];
    typed = "";
    active = false;
    window.removeEventListener("scroll", hide);
  }

  function refresh() {
    for (const m of markers) {
      if (m.label.startsWith(typed)) {
        m.node.classList.remove("slkn-hidden");
        m.node.innerHTML =
          `<span class="slkn-done">${typed}</span>${m.label.slice(typed.length)}`;
      } else {
        m.node.classList.add("slkn-hidden");
      }
    }
  }

  // ── Activate a chosen element ────────────────────────────────
  function activate(el) {
    hide();
    const href = el.matches("a[href]") ? el.href : (el.closest("a[href]") || {}).href;
    const tag = el.tagName;
    const editable =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
      el.isContentEditable;

    if (newTab && href) {
      // Keypress is a user gesture, so the popup blocker allows this.
      window.open(href, "_blank");
      return;
    }
    if (editable) {
      el.focus();
      return;
    }
    if (newTab) {
      // No real URL to open — fall back to a modifier-click so anything
      // link-like still lands in a new tab.
      el.dispatchEvent(new MouseEvent("click", {
        bubbles: true, cancelable: true, view: window,
        ctrlKey: true, metaKey: true,
      }));
      return;
    }
    el.focus({ preventScroll: true });
    el.click();
  }

  // ── Keyboard handling ────────────────────────────────────────
  function isTypingTarget() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
      el.isContentEditable;
  }

  function onKeyDown(e) {
    if (!enabled) return;

    if (active) {
      if (e.key === "Escape") { e.preventDefault(); hide(); return; }
      if (e.key === "Backspace") {
        e.preventDefault();
        typed = typed.slice(0, -1);
        refresh();
        return;
      }
      const ch = e.key.toLowerCase();
      if (ch.length === 1 && HINT_CHARS.includes(ch) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const next = typed + ch;
        const matches = markers.filter((m) => m.label.startsWith(next));
        if (matches.length === 0) return; // ignore stray keys, stay open
        typed = next;
        const exact = matches.find((m) => m.label === typed);
        if (exact) activate(exact.el);
        else refresh();
        return;
      }
      // Any other printable key cancels.
      if (e.key.length === 1) { e.preventDefault(); hide(); }
      return;
    }

    // Not active yet. No Ctrl/Meta/Alt, and never while typing in a field.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget()) return;

    if (e.key === "j" || e.key === "J") {
      e.preventDefault();
      newTab = e.key === "J";
      show();
      return;
    }

    // Uppercase (Shift) navigation commands. Kept uppercase to avoid clashing
    // with site shortcuts, accidental presses, and the lowercase hint-label
    // keys. Tab actions go through the background — content scripts can't use
    // chrome.tabs (but create/remove need no extra permission).
    switch (e.key) {
      case "H": e.preventDefault(); history.back(); break;
      case "K": e.preventDefault(); history.forward(); break;
      case "U":
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "keynav_closetab" }).catch(() => {});
        break;
      case "O":
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "keynav_newtab" }).catch(() => {});
        break;
    }
  }

  document.addEventListener("keydown", onKeyDown, true);

  // ── Master toggle + per-site exclude list ────────────────────
  // A site matches if its hostname equals an entry or is a subdomain of one
  // (e.g. "google.com" also covers "mail.google.com").
  function hostExcluded(host, list) {
    const h = (host || "").replace(/^\./, "").toLowerCase();
    return list.some((entry) => {
      const w = (entry || "").replace(/^\./, "").toLowerCase().trim();
      return w && (h === w || h.endsWith("." + w));
    });
  }

  function recompute() {
    enabled = globalEnabled && !hostExcluded(location.hostname, excludeList);
    if (!enabled && active) hide();
  }

  chrome.storage.local.get(["keynav_enabled", "keynav_exclude"], (data) => {
    globalEnabled = data.keynav_enabled !== false; // default on
    excludeList = Array.isArray(data.keynav_exclude) ? data.keynav_exclude : [];
    recompute();
  });

  // Re-evaluate live in every open tab when the popup changes settings.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.keynav_enabled) {
      globalEnabled = changes.keynav_enabled.newValue !== false;
    }
    if (changes.keynav_exclude) {
      const v = changes.keynav_exclude.newValue;
      excludeList = Array.isArray(v) ? v : [];
    }
    if (changes.keynav_enabled || changes.keynav_exclude) recompute();
  });
})();
