/**
 * FirstReply help widget (PLAN.md §3.0b, level 1). The merchant pastes one line:
 *
 *   <script src="https://<firstreply-host>/widget.js" data-shop="your-shop" async></script>
 *
 * It adds a "Problem with an order?" button. The chat runs in an iframe on FirstReply's own origin,
 * so the merchant's page never sees the buyer's session or the conversation.
 *
 * window.FirstReply.open({ link }) opens the chat already verified with a signed per-order link.
 */
(function () {
  if (window.FirstReply) return;

  var script =
    document.currentScript || document.querySelector("script[data-shop][src*='widget.js']") || document.querySelector("script[src*='widget.js']");
  if (!script) return;
  var shop = script.getAttribute("data-shop");
  if (!shop) return console.warn("FirstReply: add data-shop=\"your-shop\" to the widget script tag.");
  var origin = new URL(script.src, location.href).origin;
  var label = script.getAttribute("data-label") || "Problem with an order?";

  var css =
    ".fr-btn{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;padding:12px 18px;border:0;border-radius:999px;" +
    "background:#047857;color:#fff;font:600 14px/1 system-ui,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.18);cursor:pointer}" +
    ".fr-btn:hover{background:#065f46}.fr-btn:focus-visible{outline:3px solid #6ee7b7;outline-offset:2px}" +
    ".fr-panel{position:fixed;right:20px;bottom:84px;z-index:2147483001;width:380px;height:min(620px,calc(100vh - 110px));display:none;flex-direction:column;" +
    "overflow:hidden;border-radius:16px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.25);font:14px system-ui,-apple-system,sans-serif}" +
    ".fr-panel.fr-open{display:flex}" +
    ".fr-head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#047857;color:#fff;font-weight:600}" +
    ".fr-head span{flex:1}.fr-x{border:0;background:transparent;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:0 4px}" +
    ".fr-frame{flex:1;width:100%;border:0;background:#fff}" +
    "@media (max-width:480px){.fr-panel{inset:0;width:auto;height:auto;border-radius:0}.fr-panel.fr-open~.fr-btn{display:none}}" +
    "@media (prefers-color-scheme:dark){.fr-panel,.fr-frame{background:#09090b}}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var panel = document.createElement("div");
  panel.className = "fr-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Order help");
  var head = document.createElement("div");
  head.className = "fr-head";
  var title = document.createElement("span");
  title.textContent = "Order help";
  var close = document.createElement("button");
  close.className = "fr-x";
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  head.appendChild(title);
  head.appendChild(close);
  panel.appendChild(head);

  var button = document.createElement("button");
  button.className = "fr-btn";
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  button.appendChild(document.createTextNode(label));

  var frame = null;
  function frameUrl(link) {
    var url = origin + "/s/" + encodeURIComponent(shop) + "?embed=1&door=widget";
    return link ? url + "&link=" + encodeURIComponent(link) : url;
  }
  function open(options) {
    var link = options && options.link;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "fr-frame";
      frame.title = "Order help chat";
      frame.src = frameUrl(link);
      panel.appendChild(frame);
    } else if (link) {
      frame.src = frameUrl(link); // switch to the order the buyer just picked
    }
    panel.classList.add("fr-open");
    button.setAttribute("aria-expanded", "true");
  }
  function hide() {
    panel.classList.remove("fr-open");
    button.setAttribute("aria-expanded", "false");
    button.focus();
  }

  button.addEventListener("click", function () {
    if (panel.classList.contains("fr-open")) hide();
    else open();
  });
  close.addEventListener("click", hide);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("fr-open")) hide();
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  window.FirstReply = { open: open, close: hide };
})();
