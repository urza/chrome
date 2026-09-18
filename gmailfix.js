// ═══════════════════════════════════
//  urza's extensions: Gmail yellow importance marker
//
//  Sept 2026 Gmail update recolored the "important" marker from
//  yellow to blue. This puts it back.
//
//  Primary fix: the new marker (div.pH.a9q inside
//  div[data-is-important="true"]) takes its fill from the CSS
//  variable --pqa — override it with Google yellow 500.
//
//  Fallback: Gmail's obfuscated names (--pqa, .a9q…) change between
//  builds. Once a marker is on screen we check whether it actually
//  renders yellow now; if not, we paint the stock yellow icon
//  (label_important_fill from Google's icon set, inlined below)
//  over it as a plain background image.
// ═══════════════════════════════════
(() => {
  const STYLE_ID = "superlevels-gmailfix";
  const FALLBACK_STYLE_ID = "superlevels-gmailfix-fallback";
  const YELLOW = "#FBBC04"; // Google yellow 500 — the old marker color

  // label_important_fill_googyellow500_20dp.png (40×40, 231 bytes)
  const YELLOW_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAA" +
    "rklEQVR4Ae3WsQ3CMBQE0GtgBlgEwRBsgRgJiRVo/YPoUTq2QGlo8TfpjDxD/KUr7klp45" +
    "Pssz9iiYiIfA3XbKgLv48nHBGh3rB2w9gh5K8k7BDBH9hmw9Qh5DsP2CBCSThkw7w0pBue" +
    "9YUVIrjh3BbpEPLCXprqA07spZnLHXv20kztX+ylGduuUJemnWv+gPxbzF8S/muG/6Lmf+" +
    "r4hwX+cYt/YGUa+eOJiIj8Afwc7/hhYTWMAAAAAElFTkSuQmCC";

  const CSS = `
    div[data-is-important="true"] {
      --pqa: ${YELLOW} !important;
    }
  `;

  // Replace the marker rendering wholesale: drop any mask, paint the icon.
  const FALLBACK_CSS = `
    div[data-is-important="true"] .pH {
      background-image: url("${YELLOW_ICON}") !important;
      background-color: transparent !important;
      background-size: 20px 20px !important;
      background-repeat: no-repeat !important;
      background-position: center !important;
      -webkit-mask-image: none !important;
      mask-image: none !important;
    }
  `;

  let enabled = true;
  let verified = false; // stop watching once we've checked a rendered marker

  function setStyle(id, css) {
    let style = document.getElementById(id);
    if (css === null) {
      if (style) style.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
  }

  function apply() {
    setStyle(STYLE_ID, enabled ? CSS : null);
    if (!enabled) {
      setStyle(FALLBACK_STYLE_ID, null);
      verified = false; // re-verify if turned back on
    }
  }

  function isYellowish(rgb) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || "");
    if (!m) return false;
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    return r > 180 && g > 120 && b < 100;
  }

  // Did the --pqa override actually take? A mask-based marker exposes its
  // fill as background-color; if that isn't yellow (different variable
  // name, or an image-based marker) fall back to painting our own icon.
  function verifyMarker() {
    if (verified || !enabled) return;
    const el = document.querySelector('div[data-is-important="true"] .pH');
    if (!el) return;
    verified = true;
    const cs = getComputedStyle(el);
    const maskBased =
      (cs.webkitMaskImage && cs.webkitMaskImage !== "none") ||
      (cs.maskImage && cs.maskImage !== "none");
    if (!(maskBased && isYellowish(cs.backgroundColor))) {
      setStyle(FALLBACK_STYLE_ID, FALLBACK_CSS);
    }
  }

  // Gmail renders the list well after document_start — watch for the
  // first marker, verify once, and stop.
  const observer = new MutationObserver(() => {
    verifyMarker();
    if (verified) observer.disconnect();
  });

  function startWatching() {
    verifyMarker();
    if (!verified) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  apply();

  chrome.storage.local.get(["gmailfix_enabled"], (data) => {
    enabled = data.gmailfix_enabled !== false; // default on
    apply();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startWatching, { once: true });
    } else {
      startWatching();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.gmailfix_enabled) return;
    enabled = changes.gmailfix_enabled.newValue !== false;
    apply();
    if (enabled) startWatching();
  });
})();
