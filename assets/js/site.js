/* Career Resources — small site script
   1. Mobile menu  2. Google Docs / Word toggle  3. Prompt tabs  4. Copy buttons
   Everything still works (all content visible) if this file doesn't load. */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.remove("no-js");
  root.classList.add("js");

  /* ---------- 1. Mobile menu ---------- */
  var navBtn = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (navBtn && nav) {
    navBtn.addEventListener("click", function () {
      var open = navBtn.getAttribute("aria-expanded") === "true";
      navBtn.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && navBtn.getAttribute("aria-expanded") === "true") {
        navBtn.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
        navBtn.focus();
      }
    });
  }

  /* ---------- 2. Two-option toggles (aria-pressed buttons) ---------- */
  document.querySelectorAll("[data-toggle-group]").forEach(function (group) {
    var buttons = group.querySelectorAll("button[data-target]");
    function show(btn) {
      buttons.forEach(function (b) {
        var on = b === btn;
        b.setAttribute("aria-pressed", String(on));
        var panel = document.getElementById(b.getAttribute("data-target"));
        if (panel) panel.hidden = !on;
      });
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () { show(b); });
    });
    var start = group.querySelector('button[aria-pressed="true"]') || buttons[0];
    if (start) show(start);
  });

  /* ---------- 3. Tabs (WAI-ARIA tab pattern, arrow keys) ---------- */
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === "Home") next = tabs[0];
        if (e.key === "End") next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
    var start = list.querySelector('[aria-selected="true"]') || tabs[0];
    if (start) select(start, false);
  });

  /* ---------- 4. Copy buttons ---------- */
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var src = document.getElementById(btn.getAttribute("data-copy"));
      var status = document.getElementById(btn.getAttribute("data-status"));
      if (!src) return;
      var text = src.innerText.trim();
      function done(ok) {
        if (!status) return;
        status.textContent = ok ? "Copied!" : "Couldn't copy. Select the text and copy it yourself.";
        clearTimeout(btn._t);
        btn._t = setTimeout(function () { status.textContent = ""; }, 4000);
      }
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
      } else {
        done(fallbackCopy(text));
      }
    });
  });
  /* ---------- 5. Collapsible sections (start closed) ---------- */
  document.querySelectorAll("[data-collapse]").forEach(function (btn) {
    var body = document.getElementById(btn.getAttribute("aria-controls"));
    if (!body) return;
    var pill = btn.querySelector(".collapse-pill");
    function set(open) {
      btn.setAttribute("aria-expanded", String(open)); body.hidden = !open;
      if (pill) pill.textContent = open ? "Shrink" : "Show";
    }
    set(false);
    btn.addEventListener("click", function () { set(btn.getAttribute("aria-expanded") !== "true"); });
  });
  /* Open the section if someone follows a link to something inside it */
  function openForHash() {
    var id = location.hash.slice(1); if (!id) return;
    var el = document.getElementById(id); if (!el) return;
    var body = el.closest(".collapse-body");
    if (body && body.hidden) { var b = document.querySelector('[aria-controls="' + body.id + '"]'); if (b) b.click(); }
  }
  window.addEventListener("hashchange", openForHash); openForHash();
  /* ---------- 6. Start new pages at the top ---------- */
  (function () {
    var nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    if (location.hash || (nav && nav.type === "back_forward")) return;
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    function top() { window.scrollTo(0, 0); var f = document.body.firstElementChild; if (f && f.scrollIntoView) f.scrollIntoView({ block: "start" }); }
    top(); window.addEventListener("load", function () { top(); setTimeout(top, 60); });
  })();

  /* ---------- 7. Section tabs: a sticky, sideways-scrolling bar of the page's sections ---------- */
  (function () {
    var main = document.querySelector("main");
    var wrap = main && main.querySelector(".wrap");
    if (!wrap) return;
    var heads = Array.prototype.slice.call(wrap.querySelectorAll("section > h2[id]:not(.visually-hidden)"));
    if (heads.length < 2) return;
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var nav = document.createElement("nav");
    nav.className = "subnav";
    nav.setAttribute("aria-label", "Sections on this page");
    var inner = document.createElement("div");
    inner.className = "wrap subnav__inner";
    var ul = document.createElement("ul");
    ul.className = "subnav__list";
    var links = [];
    // "Top of page" tab on the far left
    var topLi = document.createElement("li");
    var topA = document.createElement("a");
    topA.href = "#main"; topA.className = "subnav__top";
    topA.innerHTML = '<span aria-hidden="true">\u2191 </span>Top of page';
    topLi.appendChild(topA); ul.appendChild(topLi);
    topA.addEventListener("click", function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      var h1 = document.querySelector("main h1");
      if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
      mark(topA);
    });
    heads.forEach(function (h) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      var t = h.querySelector(".collapse-title");
      a.href = "#" + h.id; a.textContent = (t || h).textContent.trim();
      li.appendChild(a); ul.appendChild(li); links.push(a);
    });
    inner.appendChild(ul); nav.appendChild(inner);
    main.insertBefore(nav, main.firstChild);

    function setCollapse(b, open) {
      var body = document.getElementById(b.getAttribute("aria-controls"));
      b.setAttribute("aria-expanded", String(open));
      if (body) body.hidden = !open;
      var pill = b.querySelector(".collapse-pill");
      if (pill) pill.textContent = open ? "Shrink" : "Show";
    }
    function goTo(target) {
      var y = target.getBoundingClientRect().top + window.pageYOffset - nav.offsetHeight - 12;
      window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    }
    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        var target = document.getElementById(a.getAttribute("href").slice(1));
        if (!target) return;
        e.preventDefault();
        // Open the collapsible this section belongs to; close every other one.
        var own = target.closest(".collapsible");
        document.querySelectorAll("[data-collapse]").forEach(function (b) {
          setCollapse(b, !!own && own.contains(b));
        });
        goTo(target);
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
        mark(a);
      });
    });

    // Highlight the current section and keep its tab in view inside the strip
    var current = null;
    function mark(active) {
      if (active === current) return;
      current = active;
      links.concat(topA).forEach(function (l) { if (l === active) l.setAttribute("aria-current", "location"); else l.removeAttribute("aria-current"); });
      if (active) {
        var left = active.parentElement.offsetLeft - 16;
        ul.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
      }
    }
    function onScroll() {
      var line = nav.offsetHeight + 40, found = topA;
      heads.forEach(function (h, i) { if (h.offsetParent !== null && h.getBoundingClientRect().top < line) found = links[i]; });
      mark(found);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  })();
  /* ---------- 8. Main menu dropdown (tap/click support; hover and keyboard focus are handled in CSS) ---------- */
  document.querySelectorAll(".has-sub").forEach(function (item) {
    var t = item.querySelector(".sub-toggle");
    if (!t) return;
    function set(open) { item.classList.toggle("is-open", open); t.setAttribute("aria-expanded", String(open)); }
    t.addEventListener("click", function (e) { e.stopPropagation(); set(!item.classList.contains("is-open")); });
    document.addEventListener("click", function (e) { if (!item.contains(e.target)) set(false); });
    item.addEventListener("keydown", function (e) { if (e.key === "Escape" && item.classList.contains("is-open")) { set(false); t.focus(); } });
  });
})();
