/* Resources directory: reads data/resources.json, filters, pages the list,
   and keeps a "share list" that can be sent as a link or downloaded as a PDF.
   No libraries, except pdfmake, which loads only when someone downloads a PDF.
   All text is added with textContent, never innerHTML. */
(function () {
  "use strict";
  var app = document.getElementById("res-app");
  if (!app) return;
  var ROOT = app.getAttribute("data-root") || "";          // "" on top-level pages, "../../" on organization pages
  var MODE = app.getAttribute("data-mode") || "all";       // all | jobs | org
  var ORG_ID = app.getAttribute("data-org") || "";
  var JOBS = MODE === "jobs", ORG = MODE === "org";
  var JOBS_GROUP = "Jobs & Education";
  var DATA_URL = ROOT + "data/resources.json";
  var SHARE_KEY = "cr-share-list";

  var form = document.getElementById("res-filters");
  var list = document.getElementById("res-list");
  var countEl = document.getElementById("res-count");
  var perSel = document.getElementById("res-per");
  var pager = document.getElementById("res-pager");
  var heading = document.getElementById("res-heading");
  var callout = document.getElementById("res-jobs-callout");

  /* ---------- where-filter rules ---------- */
  var BROAD = ["Northern California", "California (statewide)", "Nationwide"];
  var RANK = { "Northern California": 1, "California (statewide)": 2, "Nationwide": 3 };
  var LOCAL_AREAS = ["Nevada County", "Placer County", "Sacramento Area", "Yuba-Sutter Area", "Butte County", "Sierra County", "Reno, NV"];
  var LOC_LABEL = { "United States": "Nationwide", "National": "Nationwide", "Anywhere": "Nationwide", "International": "Nationwide", "Northern CA": "Northern California" };

  var ICONS = {
    income: { label: "You may need to qualify with a low income", paths: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8", "M12 18V6"] },
    faith: { label: "Faith-based program", paths: ["M12 2v5", "M9.5 4.5h5", "M5 22V11l7-4 7 4v11", "M10 22v-4a2 2 0 0 1 4 0v4", "M3 22h18"] },
    referral: { label: "Referral may be needed to receive services", paths: ["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M9 12h6", "M9 16h4"] }
  };

  var everything = [], byId = {}, orgs = {}, all = [];
  var SHARED = null;   // ids from a share link: the page shows just these
  var state = { q: "", need: "", who: "", where: "", localOnly: false, noIncome: false, noFaith: false, noReferral: false, per: 10, page: 1 };

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgIcon(key, size) {
    var NS = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("width", size); s.setAttribute("height", size);
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    ICONS[key].paths.forEach(function (d) { var p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.appendChild(p); });
    return s;
  }
  function newTab(a) {   // outside links open in a new tab and say so to screen readers
    a.target = "_blank"; a.rel = "noopener";
    a.appendChild(el("span", "visually-hidden", " (opens in a new tab)"));
    return a;
  }
  function href(url) { return /^https?:\/\//i.test(url) ? url : "https://" + url; }
  function pretty(url) { return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, ""); }
  function fileUrl(u) { return /^https?:/i.test(u) ? u : ROOT + u.replace(/^\//, ""); }

  // Adds text to a node, turning phone numbers into tel: links.
  var PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
  function addPhones(node, text) {
    var last = 0, m;
    PHONE_RE.lastIndex = 0;
    while ((m = PHONE_RE.exec(text))) {
      node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var digits = m[0].replace(/\D/g, "");
      if (digits.length === 10) digits = "1" + digits;
      var a = el("a", null, m[0]); a.href = "tel:+" + digits;
      node.appendChild(a);
      last = m.index + m[0].length;
    }
    node.appendChild(document.createTextNode(text.slice(last)));
  }
  /* Description format (shared by the website and the database editor).
     Paragraphs are split by a blank line. "- " starts a bullet; two spaces then "- " is a sub-bullet.
     A line that is only **text** is a bold heading. Inline: **bold**, *italic*, ***both***,
     bare web addresses become links, and [text](url) links are still read. */
  function fixUrl(u) { return /^(https?:|mailto:|tel:)/i.test(u) ? u : "https://" + u; }
  function prettyUrl(u) { return u.replace(/^https?:\/\//i, "").replace(/\/$/, ""); }
  var URL_SRC = "(?:https?:\\/\\/|www\\.)[^\\s<>\\[\\]]+";
  var INLINE_SRC = "\\[([^\\]]+)\\]\\(((?:https?:\\/\\/|www\\.|mailto:|tel:)[^)\\s]+)\\)" +
    "|\\*\\*\\*(?=\\S)(.+?)\\*\\*\\*|\\*\\*(?=\\S)(.+?)\\*\\*|\\*(?=[^\\s*])(.+?)\\*|(" + URL_SRC + ")";
  function trimUrl(u) {
    var tail = "";
    while (/[.,;:!?'")\]]$/.test(u)) {
      var c = u.slice(-1);
      if (c === ")" && u.split("(").length > u.split(")").length - 1) break;   // keep a balanced ")"
      tail = c + tail; u = u.slice(0, -1);
    }
    return [u, tail];
  }
  // Returns a list of pieces: {t:"text", text} | {t:"b"|"i"|"bi", kids:[...]} | {t:"a", text, href}
  function parseInline(s) {
    var out = [], last = 0, m, re = new RegExp(INLINE_SRC, "g");
    s = s || "";
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: "text", text: s.slice(last, m.index) });
      if (m[1]) out.push({ t: "a", text: /^https?:\/\//i.test(m[1]) ? prettyUrl(m[1]) : m[1], href: fixUrl(m[2]) });
      else if (m[3]) out.push({ t: "bi", kids: parseInline(m[3]) });
      else if (m[4]) out.push({ t: "b", kids: parseInline(m[4]) });
      else if (m[5]) out.push({ t: "i", kids: parseInline(m[5]) });
      else {
        var parts = trimUrl(m[6]);
        if (parts[0].length > 4) out.push({ t: "a", text: prettyUrl(parts[0]), href: fixUrl(parts[0]) });
        else out.push({ t: "text", text: parts[0] });
        if (parts[1]) out.push({ t: "text", text: parts[1] });
      }
      last = re.lastIndex;
    }
    if (last < s.length) out.push({ t: "text", text: s.slice(last) });
    return out;
  }
  // Text without any formatting marks (for search, previews and grid cells).
  function plainPieces(ps) { return ps.map(function (p) { return p.kids ? plainPieces(p.kids) : p.text; }).join(""); }
  function plainInline(s) { return plainPieces(parseInline(s)); }
  // Splits a description into blocks: paragraphs, bold headings, and bullet lists (with one level of sub-bullets).
  function parseDesc(text) {
    var blocks = [];
    (text || "").split(/\n\s*\n/).forEach(function (chunk) {
      var cur = null;
      chunk.split("\n").forEach(function (raw) {
        var line = raw.trim();
        if (!line) return;
        var item = line.match(/^[-•]\s+(.*)$/);
        var nested = item && /^\s{2,}[-•]/.test(raw);
        if (nested && cur && cur.type === "ul" && cur.items.length) {
          cur.items[cur.items.length - 1].sub.push(item[1]);
        } else if (item) {
          if (!cur || cur.type !== "ul") { cur = { type: "ul", items: [] }; blocks.push(cur); }
          cur.items.push({ text: item[1], sub: [] });
        } else if (/^\*\*[^*]+\*\*:?$/.test(line)) {
          blocks.push({ type: "h", text: line.replace(/^\*\*|\*\*:?$/g, "") });
          cur = null;
        } else {
          if (!cur || cur.type !== "p") { cur = { type: "p", lines: [] }; blocks.push(cur); }
          cur.lines.push(line);
        }
      });
    });
    return blocks;
  }
  function addPieces(node, ps, textFn) {
    ps.forEach(function (p) {
      if (p.t === "text") { if (textFn) textFn(node, p.text); else node.appendChild(document.createTextNode(p.text)); }
      else if (p.t === "a") { var a = el("a", null, p.text); a.href = p.href; if (/^https?:/i.test(p.href)) newTab(a); node.appendChild(a); }
      else {
        var w = el(p.t === "i" ? "em" : "strong");
        if (p.t === "bi") { var em = el("em"); w.appendChild(em); addPieces(em, p.kids, textFn); } else addPieces(w, p.kids, textFn);
        node.appendChild(w);
      }
    });
  }
  function addRich(node, text, textFn) { addPieces(node, parseInline(text), textFn); }
  // Contact fields (phone, address, hours): keeps line breaks and formatting; phones become links when asked.
  function multiLine(text) { return (text || "").split("\n").filter(function (l) { return l.trim(); }).length > 1; }
  function addInfo(node, text, phones) {
    if (multiLine(text)) { var box = el("div", "res-card__stack"); node.appendChild(box); node = box; }
    var fn = phones ? addPhones : null, first = true;
    parseDesc(text).forEach(function (b) {
      if (b.type === "ul") {
        var ul = el("ul");
        b.items.forEach(function (it) {
          var li = el("li"); addRich(li, it.text, fn);
          if (it.sub.length) { var sub = el("ul"); it.sub.forEach(function (t) { var sli = el("li"); addRich(sli, t, fn); sub.appendChild(sli); }); li.appendChild(sub); }
          ul.appendChild(li);
        });
        node.appendChild(ul); first = true; return;
      }
      var lines = b.type === "h" ? ["**" + b.text + "**"] : b.lines;
      lines.forEach(function (t) { if (!first) node.appendChild(el("br")); addRich(node, t, fn); first = false; });
    });
  }
  // pdfmake runs for a contact field: one line per line, bullets shown as "•".
  function infoRuns(text) {
    var out = [];
    parseDesc(text).forEach(function (b) {
      var lines = b.type === "ul" ? [] : b.type === "h" ? ["**" + b.text + "**"] : b.lines;
      if (b.type === "ul") b.items.forEach(function (it) { lines.push("• " + it.text); it.sub.forEach(function (t) { lines.push("    ◦ " + t); }); });
      lines.forEach(function (t) { if (out.length) out.push({ text: "\n" }); out = out.concat(pdfRuns(t)); });
    });
    return out;
  }
  // pdfmake text runs for one line of a description.
  function pdfRuns(text) {
    var out = [];
    (function walk(ps, f) {
      ps.forEach(function (p) {
        if (p.t === "text") out.push({ text: p.text, bold: f.b, italics: f.i });
        else if (p.t === "a") out.push({ text: p.text, link: p.href, color: "#042549", decoration: "underline", bold: f.b, italics: f.i });
        else walk(p.kids, { b: f.b || p.t !== "i", i: f.i || p.t !== "b" });
      });
    })(parseInline(text), { b: false, i: false });
    return out.length ? out : [{ text: "" }];
  }
  function renderDesc(text) {
    var box = el("div", "res-card__desc");
    parseDesc(text).forEach(function (b) {
      if (b.type === "h") { var hp = el("p", "res-card__desc-head"); addRich(hp, b.text); box.appendChild(hp); }
      else if (b.type === "ul") {
        var ul = el("ul");
        b.items.forEach(function (it) {
          var li = el("li"); addRich(li, it.text);
          if (it.sub.length) { var sub = el("ul"); it.sub.forEach(function (t) { var sli = el("li"); addRich(sli, t); sub.appendChild(sli); }); li.appendChild(sub); }
          ul.appendChild(li);
        });
        box.appendChild(ul);
      }
      else { var p = el("p"); b.lines.forEach(function (t, i) { if (i) p.appendChild(el("br")); addRich(p, t); }); box.appendChild(p); }
    });
    return box;
  }
  function tagRow(label, rest, items, cls) {
    var row = el("div", "res-card__row");
    var lead = el("span");
    lead.appendChild(el("b", null, label));
    if (rest) lead.appendChild(document.createTextNode(" " + rest));
    row.appendChild(lead);
    var ul = el("ul", "tags");
    items.forEach(function (t) { ul.appendChild(el("li", "tag " + cls, t)); });
    row.appendChild(ul);
    return row;
  }
  function placeTags(r) {
    var seen = {}, out = [];
    r.locations.forEach(function (l) { var t = LOC_LABEL[l] || l; if (!seen[t]) { seen[t] = 1; out.push(t); } });
    if (r.online && !seen.Online) out.push("Online");
    return out;
  }
  function noIn(places) { return places.every(function (p) { return p === "Online" || p === "Nationwide"; }); }   // "available nationwide", not "available in Nationwide"
  function orgPageUrl(o) { return ROOT + "organizations/" + o.slug + "/"; }

  /* ---------- share list (kept until the browser tab is closed) ---------- */
  var share = [];
  function loadShare() {
    try { share = JSON.parse(sessionStorage.getItem(SHARE_KEY) || "[]").filter(function (n) { return typeof n === "number"; }); }
    catch (e) { share = []; }
  }
  function saveShare() { try { sessionStorage.setItem(SHARE_KEY, JSON.stringify(share)); } catch (e) { /* storage blocked: list lasts for this page only */ } }
  function inShare(id) { return share.indexOf(id) >= 0; }
  function toggleShare(id, on) {
    var i = share.indexOf(id);
    if (on && i < 0) share.push(id);
    if (!on && i >= 0) share.splice(i, 1);
    saveShare(); syncShareUi();
  }
  function shareButton(r) {
    var b = el("button", "share-btn");
    b.type = "button";
    b.setAttribute("data-share-id", r.id);
    paintShareButton(b, inShare(r.id), r.name);
    b.addEventListener("click", function () { toggleShare(r.id, !inShare(r.id)); });
    return b;
  }
  function paintShareButton(b, on, name) {
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = "";
    b.appendChild(el("span", "share-btn__mark", on ? "✓" : "+")).setAttribute("aria-hidden", "true");
    b.appendChild(document.createTextNode(on ? " Added to share list" : " Add to share list"));
    b.appendChild(el("span", "visually-hidden", ": " + name));
  }

  /* ---------- filtering ---------- */
  function haystack(r) {
    if (r._hay == null) {
      r._hay = [r.name, r.org, plainInline(r.description || ""), r.phone, r.email, r.address, r.hours, r.website]
        .concat(r.needs, r.services, r.populations, r.careerTopics, r.locations, placeTags(r), (r.files || []).map(function (f) { return f.label; }))
        .join(" ").toLowerCase();
    }
    return r._hay;
  }
  function matches(r) {
    if (state.q) {
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean), hay = haystack(r);
      for (var w = 0; w < words.length; w++) if (hay.indexOf(words[w]) < 0) return false;
    }
    if (state.need && (JOBS ? r.careerTopics : r.needs).indexOf(state.need) < 0) return false;
    if (state.who && r.populations.indexOf(state.who) < 0) return false;
    if (state.noIncome && r.incomeBased) return false;
    if (state.noFaith && r.faithBased) return false;
    if (state.noReferral && r.referralNeeded) return false;
    if (state.where) {
      var ok = r.online || r.areas.indexOf(state.where) >= 0;
      var minRank = RANK[state.where] || 0; // a local area accepts every broad area; a broad area accepts broader ones
      r.areas.forEach(function (a) { if (RANK[a] && RANK[a] >= minRank) ok = true; });
      if (state.localOnly && r.areas.indexOf(state.where) < 0) ok = false; // only programs tagged with this exact place
      if (!ok) return false;
    }
    return true;
  }
  function rank(r) {
    if (!state.where) return 0;
    if (r.areas.indexOf(state.where) >= 0) return 0;
    var best = 9;
    r.areas.forEach(function (a) { if (RANK[a] && RANK[a] < best) best = RANK[a]; });
    return best === 9 ? 5 : best;
  }

  /* ---------- cards ---------- */
  function card(r) {
    var art = el("article", "res-card");
    var top = el("div", "res-card__top");
    top.appendChild(el("h3", null, r.name));
    var icons = el("div", "res-card__icons");
    [["income", r.incomeBased], ["faith", r.faithBased], ["referral", r.referralNeeded]].forEach(function (p) {
      if (!p[1]) return;
      var s = el("span", "sym sym--lg"); s.setAttribute("role", "img");
      s.setAttribute("aria-label", ICONS[p[0]].label); s.title = ICONS[p[0]].label;
      s.appendChild(svgIcon(p[0], 20)); icons.appendChild(s);
    });
    if (icons.childNodes.length) top.appendChild(icons);
    art.appendChild(top);

    var where = el("div", "res-card__row");
    var o = r.orgId && orgs[r.orgId];
    if (o && !ORG) {
      where.appendChild(el("b", null, "at"));
      if (o.count > 1) {
        var more = o.count - 1;
        var a = el("a", "tag tag--org tag--link");
        a.href = orgPageUrl(o);
        a.appendChild(el("span", "tag--org__name", o.name));
        a.appendChild(document.createTextNode(" with " + more + " additional resource" + (more === 1 ? "" : "s")));
        a.appendChild(el("span", "tag--link__arrow", " →")).setAttribute("aria-hidden", "true");
        where.appendChild(a);
      } else {
        where.appendChild(el("span", "tag tag--org", o.name));
      }
      var dot = el("span", "dot", "·"); dot.setAttribute("aria-hidden", "true"); where.appendChild(dot);
    }
    var places = placeTags(r);
    var av = el("span"); av.appendChild(el("b", null, "available"));
    if (!noIn(places)) av.appendChild(document.createTextNode(" in"));
    where.appendChild(av);
    var pul = el("ul", "tags");
    places.forEach(function (t) { pul.appendChild(el("li", "tag tag--place", t)); });
    where.appendChild(pul);
    art.appendChild(where);

    var svc = JOBS && r.careerTopics.length ? r.careerTopics : r.services;
    if (svc.length) art.appendChild(tagRow("Services", "may include", svc, "tag--service"));
    if (r.populations.length) art.appendChild(tagRow("Provided", "for", r.populations, "tag--who"));

    if (r.description) art.appendChild(renderDesc(r.description));

    var info = el("div", "res-card__info");
    function line(label, fill) { var p = el("div", "res-card__line"); p.appendChild(el("span", "label", label + ": ")); fill(p); info.appendChild(p); }
    if (r.phone) line("Phone", function (p) { addInfo(p, r.phone, true); });
    if (r.website) line("Website", function (p) { var a2 = el("a", null, pretty(r.website)); a2.href = href(r.website); p.appendChild(newTab(a2)); });
    if (r.email) line("Email", function (p) {
      var m = r.email.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i);
      if (m) { var a3 = el("a", null, m[0]); a3.href = "mailto:" + m[0]; p.appendChild(a3); p.appendChild(document.createTextNode(r.email.replace(m[0], ""))); }
      else p.appendChild(document.createTextNode(r.email));
    });
    if (r.address) line("Address", function (p) { addInfo(p, r.address, false); });
    if (r.hours) line("Hours", function (p) { addInfo(p, r.hours, true); });
    if (r.files && r.files.length) line("Handouts", function (p) {
      r.files.forEach(function (f, i) {
        if (i) p.appendChild(document.createTextNode(" · "));
        var a4 = el("a", null, f.label); a4.href = fileUrl(f.url); p.appendChild(newTab(a4));
      });
    });
    if (info.childNodes.length) art.appendChild(info);

    var actions = el("div", "res-card__actions");
    actions.appendChild(shareButton(r));
    art.appendChild(actions);
    return art;
  }

  /* ---------- list + pager ---------- */
  function pageButton(label, page, opts) {
    opts = opts || {};
    var b = el("button", "pager__btn" + (opts.cls ? " " + opts.cls : ""), label);
    b.type = "button";
    if (opts.current) b.setAttribute("aria-current", "page");
    if (opts.aria) b.setAttribute("aria-label", opts.aria);
    if (opts.disabled) b.disabled = true;
    else b.addEventListener("click", function () { state.page = page; render(true); });
    return b;
  }

  function render(moveFocus) {
    var hits = SHARED ? all.slice() : all.filter(matches).sort(function (a, b) { return rank(a) - rank(b) || a.name.localeCompare(b.name); });
    var pages = Math.max(1, Math.ceil(hits.length / state.per));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * state.per;
    var shown = hits.slice(start, start + state.per);

    list.textContent = "";
    if (!hits.length) {
      var none = el("div", "res-empty");
      none.appendChild(el("p", null, state.q
        ? "No resources match “" + state.q + "” with these choices. Try fewer or different words, pick “All areas,” or turn off one of the Additional Filters."
        : "No resources match those choices. Try a different need or area, or turn off one of the Additional Filters."));
      list.appendChild(none);
      countEl.textContent = "No resources found";
    } else {
      shown.forEach(function (r) { list.appendChild(card(r)); });
      countEl.textContent = hits.length <= state.per
        ? "Showing " + hits.length + " resource" + (hits.length === 1 ? "" : "s")
        : "Showing " + (start + 1) + "–" + (start + shown.length) + " of " + hits.length + " resources";
    }

    pager.textContent = "";
    if (pages > 1) {
      pager.appendChild(pageButton("← Previous page", state.page - 1, { disabled: state.page === 1, cls: "pager__step" }));
      var nums = el("div", "pager__nums");
      var set = [1, pages];
      for (var i = state.page - 2; i <= state.page + 2; i++) if (i > 1 && i < pages) set.push(i);
      set = set.filter(function (v, i2, a) { return a.indexOf(v) === i2; }).sort(function (a, b) { return a - b; });
      set.forEach(function (n, idx) {
        if (idx && n - set[idx - 1] > 1) { var gap = el("span", "pager__gap", "…"); gap.setAttribute("aria-hidden", "true"); nums.appendChild(gap); }
        nums.appendChild(pageButton(String(n), n, { current: n === state.page, aria: "Page " + n }));
      });
      pager.appendChild(nums);
      pager.appendChild(el("p", "pager__status", "Page " + state.page + " of " + pages));
      pager.appendChild(pageButton("Next page →", state.page + 1, { disabled: state.page === pages, cls: "pager__step" }));
    }
    pager.hidden = pages <= 1;
    if (callout) callout.hidden = state.need !== JOBS_GROUP;
    saveUrl();
    if (moveFocus) {
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start" });
    }
  }

  /* ---------- state <-> form and URL ---------- */
  function readForm() {
    if (form) {
      state.q = form.q.value.trim();
      state.need = form.need.value; state.who = form.who.value; state.where = form.where.value;
      state.localOnly = form.localOnly.checked;
      state.noIncome = form.noIncome.checked; state.noFaith = form.noFaith.checked; state.noReferral = form.noReferral.checked;
    }
    if (perSel) state.per = parseInt(perSel.value, 10) || 10;
  }
  function writeForm() {
    if (form) {
      form.q.value = state.q;
      form.need.value = state.need; form.who.value = state.who; form.where.value = state.where;
      form.localOnly.checked = state.localOnly;
      form.noIncome.checked = state.noIncome; form.noFaith.checked = state.noFaith; form.noReferral.checked = state.noReferral;
    }
    if (perSel) perSel.value = String(state.per);
    syncLocal();
  }
  function syncLocal() {   // the "only this place" box shows once a place is picked
    var wrap = document.getElementById("res-local");
    if (!wrap || !form) return;
    wrap.hidden = !form.where.value;
    if (form.where.value) wrap.querySelector(".res-local__place").textContent = form.where.value;
  }
  function saveUrl() {
    var q = new URLSearchParams();
    if (SHARED) q.set("share", SHARED.join(","));
    if (state.q) q.set("q", state.q);
    if (state.need) q.set("need", state.need);
    if (state.who) q.set("who", state.who);
    if (state.where) q.set("where", state.where);
    if (state.where && state.localOnly) q.set("local-only", "1");
    if (state.noIncome) q.set("hide-income", "1");
    if (state.noFaith) q.set("hide-faith", "1");
    if (state.noReferral) q.set("hide-referral", "1");
    if (state.per !== 10) q.set("per", state.per);
    if (state.page > 1) q.set("page", state.page);
    var s = q.toString().replace(/%2C/g, ",");
    try { history.replaceState(null, "", s ? "?" + s : location.pathname); } catch (e) { /* preview frames may block this */ }
  }
  function loadUrl() {
    var q = new URLSearchParams(location.search);
    if (q.get("q")) state.q = q.get("q");
    if (q.get("need")) state.need = q.get("need");
    if (q.get("who")) state.who = q.get("who");
    if (q.get("where") && q.get("where") !== "all") state.where = q.get("where");
    state.localOnly = q.get("local-only") === "1";
    state.noIncome = q.get("hide-income") === "1"; state.noFaith = q.get("hide-faith") === "1"; state.noReferral = q.get("hide-referral") === "1";
    if ([10, 20, 50].indexOf(parseInt(q.get("per"), 10)) >= 0) state.per = parseInt(q.get("per"), 10);
    if (parseInt(q.get("page"), 10) > 1) state.page = parseInt(q.get("page"), 10);
    return q.get("share");
  }

  function fillSelect(sel, firstLabel, values) {
    sel.textContent = "";
    var o = el("option", null, firstLabel); o.value = ""; sel.appendChild(o);
    values.forEach(function (v) { var op = el("option", null, v); op.value = v; sel.appendChild(op); });
  }

  /* ---------- share tray ---------- */
  var fab, dialog, trayList, trayCount, trayMsg, linkBox, btnPdf, btnCopy;
  function buildTray() {
    fab = el("button", "share-fab");
    fab.type = "button";
    fab.setAttribute("aria-haspopup", "dialog");
    fab.hidden = true;
    fab.addEventListener("click", openTray);
    document.body.appendChild(fab);

    dialog = el("dialog", "share-tray");
    dialog.setAttribute("aria-labelledby", "share-title");
    var head = el("div", "share-tray__head");
    var h = el("h2", null, "Your Share List"); h.id = "share-title";
    head.appendChild(h);
    var close = el("button", "share-tray__close", "Close");
    close.type = "button"; close.addEventListener("click", function () { dialog.close(); });
    head.appendChild(close);
    dialog.appendChild(head);
    trayCount = el("p", "share-tray__count");
    dialog.appendChild(trayCount);
    trayList = el("ol", "share-tray__list");
    dialog.appendChild(trayList);
    trayMsg = el("p", "share-tray__msg"); trayMsg.setAttribute("role", "status"); trayMsg.hidden = true;
    dialog.appendChild(trayMsg);
    linkBox = el("input", "share-tray__link"); linkBox.type = "text"; linkBox.readOnly = true; linkBox.hidden = true;
    linkBox.setAttribute("aria-label", "Share link");
    dialog.appendChild(linkBox);
    var acts = el("div", "share-tray__actions");
    btnPdf = el("button", "share-tray__btn share-tray__btn--primary", "Download PDF"); btnPdf.type = "button"; btnPdf.addEventListener("click", downloadPdf);
    btnCopy = el("button", "share-tray__btn", "Copy share link"); btnCopy.type = "button"; btnCopy.addEventListener("click", copyLink);
    var clr = el("button", "share-tray__btn share-tray__btn--quiet", "Clear list"); clr.type = "button";
    clr.addEventListener("click", function () { share = []; saveShare(); syncShareUi(); linkBox.hidden = true; note("Your list is empty."); });
    acts.appendChild(btnPdf); acts.appendChild(btnCopy); acts.appendChild(clr);
    dialog.appendChild(acts);
    dialog.appendChild(el("p", "share-tray__fine", "Your list is saved until you close this browser tab. The share link opens a page that lists these resources, on any phone or computer."));
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });   // click outside the panel
    document.body.appendChild(dialog);
  }
  function note(text) { trayMsg.textContent = text; trayMsg.hidden = !text; }
  function openTray() { note(""); linkBox.hidden = true; syncShareUi(); if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", ""); }
  function shareItems() { return share.map(function (id) { return byId[id]; }).filter(Boolean); }
  function syncShareUi() {
    var items = shareItems();
    fab.hidden = !items.length;
    fab.textContent = "";
    fab.appendChild(el("span", "share-fab__label", "Share list"));
    fab.appendChild(el("span", "share-fab__count", String(items.length)));
    fab.setAttribute("aria-label", "Open share list, " + items.length + " resource" + (items.length === 1 ? "" : "s"));
    trayCount.textContent = items.length ? items.length + " resource" + (items.length === 1 ? "" : "s") + " in your list" : "Your list is empty. Use “Add to share list” on any resource.";
    trayList.textContent = "";
    items.forEach(function (r) {
      var li = el("li");
      var txt = el("div", "share-tray__item");
      txt.appendChild(el("span", "share-tray__name", r.name));
      if (r.org) txt.appendChild(el("span", "share-tray__org", r.org));
      li.appendChild(txt);
      var rm = el("button", "share-tray__remove", "Remove from list"); rm.type = "button";
      rm.appendChild(el("span", "visually-hidden", ": " + r.name));
      rm.addEventListener("click", function () { toggleShare(r.id, false); note(r.name + " removed."); });
      li.appendChild(rm);
      trayList.appendChild(li);
    });
    btnPdf.disabled = btnCopy.disabled = !items.length;
    Array.prototype.forEach.call(document.querySelectorAll("[data-share-id]"), function (b) {
      var r = byId[b.getAttribute("data-share-id")]; if (r) paintShareButton(b, inShare(r.id), r.name);
    });
  }
  function shareLink() {
    var u = new URL(ROOT + "resources.html", location.href);
    u.search = "?share=" + share.join(",");
    u.hash = "";
    return u.href.replace(/\/resources\.html\?/, "/resources?");
  }
  function copyLink() {
    var link = shareLink();
    linkBox.value = link; linkBox.hidden = false;
    function fallback() { linkBox.focus(); linkBox.select(); note("Select the link above and copy it."); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(function () { note("Link copied. Paste it into a text or email."); }, fallback);
    } else fallback();
  }

  /* ---------- PDF ---------- */
  var pdfReady = null;
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function getPdfMake() {
    if (!pdfReady) {
      pdfReady = loadScript(ROOT + "assets/js/vendor/pdfmake.min.js")
        .then(function () { return loadScript(ROOT + "assets/js/vendor/vfs_fonts.js"); })
        .then(function () { return window.pdfMake; })
        .catch(function (e) { pdfReady = null; throw e; });
    }
    return pdfReady;
  }
  function pdfDoc(items) {
    var NAVY = "#042549", FOREST = "#005641", GREY = "#4A4A4A";
    var today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    var body = [];
    items.forEach(function (r, i) {
      var stack = [];
      stack.push({ text: r.name, style: "name" });
      var sub = [];
      if (r.org) sub.push("at " + r.org);
      var places = placeTags(r); if (places.length) sub.push((noIn(places) ? "available " : "available in ") + places.join(", "));
      if (sub.length) stack.push({ text: sub.join("  ·  "), style: "sub" });
      var flags = [];
      if (r.incomeBased) flags.push("You may need to qualify with a low income");
      if (r.referralNeeded) flags.push("Referral may be needed");
      if (r.faithBased) flags.push("Faith-based program");
      if (flags.length) stack.push({ text: flags.join("  ·  "), style: "flag" });
      if (r.description) parseDesc(r.description).forEach(function (b) {
        if (b.type === "h") stack.push({ text: pdfRuns(b.text), style: "descHead" });
        else if (b.type === "ul") stack.push({ ul: b.items.map(function (it) {
          return it.sub.length ? { stack: [{ text: pdfRuns(it.text) }, { ul: it.sub.map(function (t) { return { text: pdfRuns(t) }; }), type: "circle", margin: [0, 1, 0, 0] }] } : { text: pdfRuns(it.text) };
        }), style: "descList" });
        else stack.push({ text: b.lines.reduce(function (acc, t, k) { return acc.concat(k ? [{ text: "\n" }] : [], pdfRuns(t)); }, []), style: "desc" });
      });
      function row(label, value, link, rich) {
        stack.push({ text: [{ text: label + ": ", bold: true }].concat(link ? [{ text: value, link: link, color: NAVY, decoration: "underline" }] : rich ? (multiLine(value) ? [{ text: "\n" }] : []).concat(infoRuns(value)) : [{ text: value }]), style: "info" });
      }
      if (r.phone) row("Phone", r.phone, null, true);
      if (r.website) row("Website", pretty(r.website), href(r.website));
      if (r.email) row("Email", r.email);
      if (r.address) row("Address", r.address, null, true);
      if (r.hours) row("Hours", r.hours, null, true);
      (r.files || []).forEach(function (f) { var u = new URL(fileUrl(f.url), location.href).href; row("Handout", f.label, u); });
      var short = (r.description || "").length < 1400;        // only very long entries may split across pages
      body.push({ stack: stack, unbreakable: short, margin: [0, i ? 12 : 0, 0, 12] });
      if (i < items.length - 1) body.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 516, y2: 0, lineWidth: 0.75, lineColor: "#C9C3B3" }] });
    });
    return {
      pageSize: "LETTER",
      pageMargins: [48, 64, 48, 56],
      info: { title: "Resource List – Career Resources", author: "Career Resources" },
      header: function () {
        return { margin: [48, 26, 48, 0], columns: [
          { text: "Career Resources", bold: true, color: NAVY, fontSize: 12 },
          { text: "Resource list · " + today, alignment: "right", color: GREY, fontSize: 9, margin: [0, 2, 0, 0] }
        ] };
      },
      footer: function (page, pages) {
        return { margin: [48, 18, 48, 0], columns: [
          { text: "career-resources.com", fontSize: 8, color: GREY },
          { text: "Page " + page + " of " + pages, alignment: "right", fontSize: 8, color: GREY, width: 70 }
        ] };
      },
      content: [
        { text: "Your Resource List", style: "title" },
        { text: "Program details can change. Call or visit the program's website before you go.", style: "intro" }
      ].concat(body),
      styles: {
        title: { fontSize: 20, bold: true, color: NAVY, margin: [0, 0, 0, 4] },
        intro: { fontSize: 10, color: GREY, margin: [0, 0, 0, 16] },
        name: { fontSize: 13, bold: true, color: NAVY, margin: [0, 0, 0, 2] },
        sub: { fontSize: 9.5, color: FOREST, margin: [0, 0, 0, 4] },
        flag: { fontSize: 9, italics: true, color: GREY, margin: [0, 0, 0, 4] },
        desc: { fontSize: 10, lineHeight: 1.2, margin: [0, 0, 0, 6] },
        descHead: { fontSize: 10, bold: true, margin: [0, 2, 0, 2] },
        descList: { fontSize: 10, lineHeight: 1.1, margin: [8, 0, 0, 6] },
        info: { fontSize: 10, margin: [0, 0, 0, 2] }
      },
      defaultStyle: { font: "Roboto", fontSize: 10, color: "#212121" }
    };
  }
  function makePdf(items, btn, say) {
    if (!items.length) return;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = "Making PDF…";
    say("");
    getPdfMake().then(function (pm) {
      pm.createPdf(pdfDoc(items)).download("resource-list-" + new Date().toISOString().slice(0, 10) + ".pdf");
      say("Your PDF is downloading. Open it to print or save it.");
    }).catch(function () {
      say("The PDF didn't download. Check your internet connection and try again.");
    }).then(function () { btn.disabled = false; btn.textContent = label; });
  }
  function downloadPdf() { makePdf(shareItems(), btnPdf, note); }

  /* ---------- shared-list view (opened from a share link) ---------- */
  function sharedBanner() {
    var items = SHARED.map(function (id) { return byId[id]; });
    var box = el("div", "shared-banner");
    box.appendChild(el("h2", "shared-banner__title", items.length + " resource" + (items.length === 1 ? " was" : "s were") + " shared with you"));
    box.appendChild(el("p", null, "These are the resources in the list someone sent you. You can download them as a PDF, or browse all our resources."));
    var acts = el("div", "shared-banner__actions");
    var pdf = el("button", "shared-banner__btn shared-banner__btn--primary", "Download as PDF"); pdf.type = "button";
    var msg = el("p", "shared-banner__msg"); msg.setAttribute("role", "status"); msg.hidden = true;
    function say(t) { msg.textContent = t; msg.hidden = !t; }
    pdf.addEventListener("click", function () { makePdf(items, pdf, say); });
    var addAll = el("button", "shared-banner__btn", "Add all to my share list"); addAll.type = "button";
    addAll.addEventListener("click", function () { items.forEach(function (r) { if (!inShare(r.id)) share.push(r.id); }); saveShare(); syncShareUi(); say("Added to your share list."); });
    var browse = el("a", "shared-banner__btn shared-banner__btn--link", "Browse all resources"); browse.href = ROOT + "resources.html";
    acts.appendChild(pdf); acts.appendChild(addAll); acts.appendChild(browse);
    box.appendChild(acts); box.appendChild(msg);
    return box;
  }
  window.crResourcePdf = function () { return getPdfMake().then(function (pm) { return pm.createPdf(pdfDoc(shareItems())); }); };  // used by tests

  /* ---------- start ---------- */
  function start(data) {
    everything = data.resources; orgs = data.orgs || {};
    everything.forEach(function (r) { byId[r.id] = r; });
    all = JOBS ? everything.filter(function (r) { return r.needs.indexOf(JOBS_GROUP) >= 0; })
        : ORG ? everything.filter(function (r) { return r.orgId === ORG_ID; })
        : everything.filter(function (r) { return !(r.needs.length === 1 && r.needs[0] === JOBS_GROUP); });   // jobs-only resources live on the Jobs & Education page
    if (form) {
      if (JOBS) {
        var tp = {}; all.forEach(function (r) { r.careerTopics.forEach(function (t) { tp[t] = 1; }); });
        fillSelect(form.need, "All job and education help", Object.keys(tp).sort());
      } else {
        fillSelect(form.need, "All needs", data.needGroups.filter(function (g) { return all.some(function (r) { return r.needs.indexOf(g) >= 0; }); }));
      }
      var pops = {}; all.forEach(function (r) { r.populations.forEach(function (p) { if (p !== "Everyone") pops[p] = 1; }); });
      var hasEveryone = all.some(function (r) { return r.populations.indexOf("Everyone") >= 0; });
      fillSelect(form.who, "All groups", (hasEveryone ? ["Everyone"] : []).concat(Object.keys(pops).sort()));
      var present = {}; all.forEach(function (r) { r.areas.forEach(function (a) { present[a] = 1; }); });
      fillSelect(form.where, "All areas", LOCAL_AREAS.concat(BROAD).filter(function (a) { return present[a]; }));
    }
    loadShare();
    var shared = loadUrl();
    if (shared) {
      var ids = [];
      shared.split(",").map(function (n) { return parseInt(n, 10); }).forEach(function (id) { if (byId[id] && ids.indexOf(id) < 0) ids.push(id); });
      if (ids.length) {
        SHARED = ids;
        all = ids.map(function (id) { return byId[id]; });
        if (form) form.closest("section").hidden = true;
        var head = document.querySelector(".res-head");
        head.parentNode.insertBefore(sharedBanner(), head);
        var h1 = document.getElementById("page-title"); if (h1) h1.textContent = "Shared Resources";
        var subh = document.querySelector(".hero .subhead"); if (subh) subh.textContent = "A list of resources someone picked out for you.";
        document.title = "Shared Resources | Career Resources";
      }
    }
    writeForm(); readForm();
    buildTray();
    if (form) {
      form.addEventListener("change", function (e) { if (e.target === form.q) return; syncLocal(); readForm(); state.page = 1; render(false); });
      form.addEventListener("submit", function (e) { e.preventDefault(); });
      var timer;
      form.q.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { readForm(); state.page = 1; render(false); }, 300); });
      form.querySelector(".res-search__clear").addEventListener("click", function () { form.q.value = ""; readForm(); state.page = 1; render(false); form.q.focus(); });
    }
    if (perSel) perSel.addEventListener("change", function () { readForm(); state.page = 1; render(false); });
    render(false);
    syncShareUi();
  }

  fetch(DATA_URL)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(start)
    .catch(function () {
      countEl.textContent = "Sorry, the resource list didn't load.";
      list.textContent = "";
      list.appendChild(el("p", "res-empty", "Please refresh the page or try again later."));
    });
})();
