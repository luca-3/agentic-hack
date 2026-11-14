/**
 * Visible "Lotse erkundet …" banner during an exploration (D-25): the admin always sees that Lotse is clicking,
 * and can stop it from the page. Shadow DOM, own host (excluded from every scan).
 */
export const BANNER_HOST_ID = "lotse-explore-banner";

const STYLE = `
:host { all: initial; }
.bar { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); z-index: 2147483647; display: flex; align-items: center; gap: 10px;
  padding: 8px 10px 8px 14px; border-radius: 999px; background: #7c2d12; color: #fff; font: 600 13px/1.3 system-ui, sans-serif;
  box-shadow: 0 6px 20px rgb(0 0 0 / .28); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #fdba74; animation: pulse 1s infinite alternate; }
.detail { font-weight: 400; opacity: .9; }
button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px; background: #fff; color: #7c2d12; font: 700 12px/1.4 system-ui, sans-serif; }
button:focus-visible { outline: 2px solid #fdba74; outline-offset: 2px; }
@keyframes pulse { from { opacity: .35; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
`;

let host: HTMLDivElement | null = null;
let detail: HTMLSpanElement | null = null;

export function showBanner(text: string, onStop: () => void) {
  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.id = BANNER_HOST_ID;
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "status");
    const dot = document.createElement("span");
    dot.className = "dot";
    const title = document.createElement("span");
    title.textContent = "Lotse erkundet die App";
    detail = document.createElement("span");
    detail.className = "detail";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "Stopp";
    stop.addEventListener("click", (event) => { event.stopPropagation(); onStop(); });
    bar.append(dot, title, detail, stop);
    root.append(style, bar);
    document.documentElement.append(host);
  }
  if (detail) detail.textContent = text;
}

export function hideBanner() {
  host?.remove();
  host = null;
  detail = null;
}
