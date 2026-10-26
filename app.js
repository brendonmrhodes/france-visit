/* App logic. You shouldn't need to edit this file: activities live in activities.js, settings in config.js. */
const RATINGS = [ { v: 3, label: "Must do" }, { v: 2, label: "Would like" }, { v: 1, label: "Maybe" }, { v: -1, label: "Skip" } ];
const RATINGS_FOOD = [ { v: 3, label: "Must try" }, { v: 2, label: "Would try" }, { v: 1, label: "Maybe" }, { v: -1, label: "Pass" } ];
const ratingsFor = a => a.area === "food" ? RATINGS_FOOD : RATINGS;
const labelFor = (a, v) => (ratingsFor(a).find(r => r.v === v) || {}).label || "";
const byId = Object.fromEntries(ACTIVITIES.map(a => [a.id, a]));
const areaName = id => (AREAS.find(x => x.id === id) || {}).name || id;
const VOTABLE = ACTIVITIES.filter(a => !a.closed);
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const photoSrc = (f, w = 640) => "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(f) + "?width=" + w;
const photoPage = f => "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(f);
const euro = n => "€" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

function load(key, fb) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb } catch { return fb } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }
const clone = o => JSON.parse(JSON.stringify(o));

// ---- trip days ----
const DAYS = []; for (let d = 10; d <= 22; d++) DAYS.push("2026-12-" + d);
const dayDate = iso => new Date(iso + "T12:00:00");
const fmtDay = iso => dayDate(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtDayLong = iso => dayDate(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const weekdayOf = iso => dayDate(iso).toLocaleDateString("en-US", { weekday: "long" });
function closedWarning(a, iso) {
  const m = (a.closedDays || "").match(/closed (mon|tue|wed|thu|fri|sat|sun)/i);
  if (m && weekdayOf(iso).toLowerCase().startsWith(m[1].toLowerCase())) return a.closedDays;
  if ((a.closedDates || []).includes(iso)) return "Closed that day";
  if (a.closedBefore && iso < a.closedBefore) return "Not open until " + fmtDay(a.closedBefore);
  return null;
}

// ---- state ----
const ONLINE = !!(CONFIG.SCRIPT_URL || "").trim();
const PLAN_KEY = "_plan";                 // reserved row in the Sheet that holds the draft plan
const blank = () => ({ r: {}, note: {}, top: [], ideas: [] });
const blankPlan = () => ({ days: {}, note: {}, booking: {}, options: {} });
const chosen = (aid, oid) => ((plan.options || {})[aid] || []).includes(oid);
let sortMode = load("fg-sort", "default");
const BOOK_LABEL = { sellout: "Sells out: book the moment the day is fixed", advised: "Timed slot or online-only ticket" };
const STATUS = ["Not booked", "Booked", "Confirmed"];
let me = load("fg-me", "");            // the family name this browser votes as
let mine = blank();
let all = {};                          // name -> vote data
let plan = blankPlan();
let filterArea = "all", filterTag = null;
let openNotes = new Set();
const canWrite = () => !!me;
const people = () => Object.keys(all).filter(n => !n.startsWith("_"));

// ---- server ----
function absorb(votes) {
  plan = votes[PLAN_KEY] ? { ...blankPlan(), ...votes[PLAN_KEY] } : blankPlan();
  all = {}; for (const [k, v] of Object.entries(votes)) if (!k.startsWith("_")) all[k] = v;
}
async function fetchAll() {
  if (!ONLINE) { absorb(load("fg-local-votes", {})); return true }
  try {
    const res = await fetch(CONFIG.SCRIPT_URL, { cache: "no-store" });
    const j = await res.json();
    if (j.ok) { absorb(j.votes || {}); return true }
  } catch {}
  return false;
}
async function push(name, data) {
  if (!ONLINE) { const l = load("fg-local-votes", {}); l[name] = data; store("fg-local-votes", l); return { ok: true } }
  const res = await fetch(CONFIG.SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ name, data }) });
  return res.json();
}

// ---- saving (one request at a time, debounced) ----
let saveTimer = null, saving = Promise.resolve(), dirty = false, planDirty = false;
function setStatus(t, ok) { $("#status").textContent = t; $("#savedot").classList.toggle("ok", !!ok) }
function savedStatus() { setStatus(ONLINE ? "Saved" : "Saved on this device only", true) }
function queueSave() {
  if (!canWrite()) return;
  dirty = true; setStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(async () => {
      if (!dirty) return; dirty = false;
      try {
        const j = await push(me, mine);
        if (j && j.ok) { all[me] = clone(mine); savedStatus() }
        else setStatus("Couldn't save. Try again in a moment.");
      } catch { setStatus("Couldn't save. Check your connection.") }
    });
  }, 900);
}
let planTimer = null;
function queuePlanSave() {
  planDirty = true; setStatus("Saving plan…");
  clearTimeout(planTimer);
  planTimer = setTimeout(() => {
    saving = saving.then(async () => {
      if (!planDirty) return; planDirty = false;
      try { const j = await push(PLAN_KEY, plan); if (j && j.ok) savedStatus(); else setStatus("Couldn't save the plan. Try again in a moment.") }
      catch { setStatus("Couldn't save the plan. Check your connection.") }
    });
  }, 900);
}

// ---- who am I ----
function renderWho() {
  const w = $("#who");
  if ($("#me")) { $("#me").value = me; return }
  const sel = el("select", { id: "me", "aria-label": "Who are you?" });
  sel.append(el("option", { value: "", text: "Choose your name…" }));
  for (const n of CONFIG.FAMILY) sel.append(el("option", { value: n, text: n }));
  sel.value = me;
  sel.addEventListener("change", () => {
    me = sel.value; store("fg-me", me);
    mine = me && all[me] ? clone({ ...blank(), ...all[me] }) : blank();
    setStatus(me ? "Voting as " + me : "Pick your name to vote", !!me);
    render();
  });
  w.prepend(el("label", { for: "me", text: "I'm" }), sel);
}
const ratedCount = d => VOTABLE.filter(a => d.r && d.r[a.id] != null).length;

// ---- browse ----
function renderFilters() {
  const f = $("#filters"); f.replaceChildren();
  const mk = (label, pressed, on) => el("button", { class: "chipbtn", "aria-pressed": String(pressed), onclick: on, text: label });
  f.append(mk("Everything", filterArea === "all", () => { filterArea = "all"; render() }));
  for (const a of AREAS) f.append(mk(a.name, filterArea === a.id, () => { filterArea = a.id; render() }));
  f.append(el("span", { class: "sep" }));
  for (const [k, label] of Object.entries(TAGS)) f.append(mk(label, filterTag === k, () => { filterTag = filterTag === k ? null : k; render() }));
  f.append(mk("Free", filterTag === "free", () => { filterTag = filterTag === "free" ? null : "free"; render() }));
  f.append(mk("Not rated by me", filterTag === "unrated", () => { filterTag = filterTag === "unrated" ? null : "unrated"; render() }));
  const sort = el("select", { class: "sortsel", "aria-label": "Sort cards" });
  [["default", "Sort: as listed"], ["price-asc", "Sort: cheapest first"], ["price-desc", "Sort: priciest first"], ["score", "Sort: family score"], ["mine", "Sort: my rating"]].forEach(([v, t]) => sort.append(el("option", { value: v, text: t })));
  sort.value = sortMode; sort.addEventListener("change", () => { sortMode = sort.value; store("fg-sort", sortMode); render() });
  f.append(sort);
  if (me) {
    const n = ratedCount(mine), total = VOTABLE.length;
    const p = el("div", { class: "progress" }, el("span", { text: `You've rated ${n} of ${total}` }), el("span", { class: "pbar" }, el("span", { style: `width:${100 * n / total}%` })));
    f.after(p); const old = $("#progress-me"); if (old) old.remove(); p.id = "progress-me";
  } else { const old = $("#progress-me"); if (old) old.remove() }
}

function othersLine(a) {
  const wrap = el("div", { class: "others" });
  for (const [name, d] of Object.entries(all)) {
    if (name === me) continue;
    const v = d.r && d.r[a.id]; const starred = (d.top || []).includes(a.id);
    if (v == null && !starred) continue;
    wrap.append(el("span", { class: "p" }, name + ": ", el("i", { text: (v != null ? labelFor(a, v) : "") + (starred ? " ★" : "") })));
  }
  return wrap.childNodes.length ? wrap : null;
}

function photo(a) {
  if (!a.photo) return null;
  const fig = el("figure", { class: "photo" });
  const img = el("img", { src: photoSrc(a.photo), alt: a.title, loading: "lazy", decoding: "async" });
  img.addEventListener("error", () => fig.classList.add("missing"));
  img.addEventListener("click", () => openLightbox(a));
  fig.append(img, el("a", { class: "credit", href: photoPage(a.photo), target: "_blank", rel: "noopener", text: "Photo: Wikimedia Commons" }));
  return fig;
}

function plannedOn(id) { return DAYS.filter(d => (plan.days[d] || []).includes(id)) }

function card(a) {
  const myV = mine.r[a.id]; const starred = mine.top.includes(a.id);
  const food = a.area === "food";
  const tags = el("div", { class: "tags" });
  if (a.closed) tags.append(el("span", { class: "tag closedtag", text: "Not open in December" }));
  for (const t of a.tags) tags.append(el("span", { class: "tag" + (t === "ww2" ? " ww2" : t === "xmas" ? " xmas" : ""), text: TAGS[t] || t }));
  if (typeof PASS !== "undefined" && PASS.covers.includes(a.id)) tags.append(el("span", { class: "tag pass", text: "Museum Pass" }));
  const meta = food
    ? el("div", { class: "meta" }, el("span", { text: a.origin }), el("span", { class: "price", text: a.price }))
    : el("div", { class: "meta" },
      el("span", { text: "From Fontainebleau: " + a.travel }), el("span", { text: "Time: " + a.time }),
      a.closedDays ? el("span", { text: a.closedDays }) : null,
      el("span", { class: "price", text: a.price || a.cost }));
  const c = el("article", { class: "card" + (a.closed ? " closed" : ""), id: "card-" + a.id }, photo(a),
    el("h3", { text: a.title }), meta, el("p", { class: "blurb", text: a.blurb }),
    food ? el("p", { class: "dec" }, el("b", { text: "Where: " }), a.where) : el("p", { class: "dec" }, el("b", { text: "In December: " }), a.dec), tags);
  if (a.options && a.options.length) {
    const ex = el("div", { class: "extras" }, el("span", { class: "small", text: "Paid extras (tick what we'd actually do):" }));
    for (const o of a.options) {
      const cb = el("input", { type: "checkbox", id: "opt-" + a.id + "-" + o.id, disabled: !canWrite() });
      cb.checked = chosen(a.id, o.id);
      cb.addEventListener("change", () => { const cur = new Set((plan.options || (plan.options = {}))[a.id] || []); cb.checked ? cur.add(o.id) : cur.delete(o.id); plan.options[a.id] = [...cur]; queuePlanSave(); render() });
      ex.append(el("label", { for: cb.id, class: "extra" + (cb.checked ? " on" : "") }, cb, ` ${o.label} · ${euro(o.price)}${o.perGroup ? " shared" : " each"}${o.pass ? " · Museum Pass" : ""}`));
    }
    c.append(ex);
  }
  const on = plannedOn(a.id);
  if (on.length) c.append(el("div", { class: "planned", text: "In the plan: " + on.map(fmtDay).join(", ") + bookBadge(a.id) }));
  if (!a.closed) {
    const rate = el("div", { class: "rate", role: "group", "aria-label": food ? "Do you want to try this?" : "How much do you want this?" });
    for (const r of ratingsFor(a)) rate.append(el("button", { "data-v": String(r.v), "aria-pressed": String(myV === r.v), disabled: !canWrite(),
      title: canWrite() ? null : "Pick your name at the top first",
      onclick: () => { if (mine.r[a.id] === r.v) delete mine.r[a.id]; else mine.r[a.id] = r.v; queueSave(); render() }, text: r.label }));
    c.append(rate);
    const hasNote = !!(mine.note[a.id] || "").trim();
    c.append(el("div", { class: "row" },
      el("button", { class: "star", "aria-pressed": String(starred), disabled: !canWrite(), onclick: () => toggleTop(a.id),
        text: starred ? "★ In my top 5 (#" + (mine.top.indexOf(a.id) + 1) + ")" : "☆ Add to my top 5" }),
      canWrite() ? el("button", { class: "linkish", onclick: () => { openNotes.has(a.id) ? openNotes.delete(a.id) : openNotes.add(a.id); render() },
        text: openNotes.has(a.id) ? "Hide note" : hasNote ? "Edit my note" : "Add a note" }) : null,
      food ? null : el("a", { class: "linkish", href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a.title + " France"), target: "_blank", rel: "noopener", text: "Map" }),
      el("button", { class: "linkish", title: "Copy a link to this card", onclick: () => copyLink(a.id), text: "Link" })));
    if (openNotes.has(a.id) && canWrite()) {
      const ta = el("textarea", { id: "note-" + a.id, placeholder: "Thoughts, questions, must-sees…", maxlength: "1000" });
      ta.value = mine.note[a.id] || "";
      ta.addEventListener("input", () => { mine.note[a.id] = ta.value; queueSave() });
      c.append(ta);
    }
    const o = othersLine(a); if (o) c.append(o);
  }
  return c;
}

function toggleTop(id) {
  const i = mine.top.indexOf(id);
  if (i >= 0) mine.top.splice(i, 1);
  else { if (mine.top.length >= 5) { flash("Your top 5 is full. Remove one under Family picks first."); return } mine.top.push(id) }
  queueSave(); render();
}
let baseNotice = "";
function flash(msg) { const n = $("#notice"); n.textContent = msg; n.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => { n.textContent = baseNotice; n.hidden = !baseNotice }, 3500) }

function renderBrowse() {
  renderFilters();
  const root = $("#areas"); root.replaceChildren();
  for (const area of AREAS) {
    if (filterArea !== "all" && filterArea !== area.id) continue;
    let items = ACTIVITIES.filter(a => a.area === area.id);
    if (filterTag === "unrated") items = items.filter(a => !a.closed && mine.r[a.id] == null);
    else if (filterTag === "free") items = items.filter(a => !a.closed && !a.budget);
    else if (filterTag) items = items.filter(a => a.tags.includes(filterTag));
    if (sortMode !== "default") {
      const sc = sortMode === "score" ? Object.fromEntries(scoreRows(allVotes()).map(r => [r.a.id, r.score])) : null;
      items = items.slice().sort((x, y) => sortMode === "price-asc" ? (x.budget || 0) - (y.budget || 0) : sortMode === "price-desc" ? (y.budget || 0) - (x.budget || 0)
        : sortMode === "score" ? (sc[y.id] || 0) - (sc[x.id] || 0) : (mine.r[y.id] || 0) - (mine.r[x.id] || 0));
    }
    if (!items.length) continue;
    const grid = el("div", { class: "grid" }); items.forEach(a => grid.append(card(a)));
    root.append(el("section", { class: "area", id: "area-" + area.id },
      el("div", { class: "area-head" }, el("h2", { text: area.name }), el("p", { text: area.note })), grid));
  }
  if (!root.childNodes.length) root.append(el("p", { class: "empty", text: "Nothing matches these filters." }));
}

// ---- results ----
function allVotes() { const votes = clone(all); if (me) votes[me] = clone(mine); return votes }
function scoreRows(votes) {
  const ppl = Object.keys(votes);
  return VOTABLE.map(a => {
    const c = { 3: 0, 2: 0, 1: 0, "-1": 0 }; let score = 0, stars = 0; const who = {};
    for (const p of ppl) { const d = votes[p]; const v = d.r && d.r[a.id]; if (v != null) { c[v]++; score += v; who[p] = v } if ((d.top || []).includes(a.id)) { stars++; score += 2 } }
    return { a, c, score, stars, who, n: c[3] + c[2] + c[1] + c["-1"] };
  });
}

function renderResults() {
  const votes = allVotes(); const ppl = Object.keys(votes); const total = Math.max(1, ppl.length);
  const rows = scoreRows(votes).filter(r => r.n || r.stars).sort((x, y) => y.score - x.score || y.c[3] - x.c[3]);

  // progress
  const pg = $("#progress"); pg.replaceChildren();
  if (!ppl.length) pg.append(el("p", { class: "empty", text: "No one has voted yet." }));
  else for (const p of ppl) {
    const n = ratedCount(votes[p]);
    pg.append(el("div", { class: "prow" }, el("b", { text: p }), el("span", { class: "pbar" }, el("span", { style: `width:${100 * n / VOTABLE.length}%` })),
      el("span", { class: "small", text: `${n} of ${VOTABLE.length} rated · ${(votes[p].top || []).length} of 5 starred` })));
  }
  const missing = CONFIG.FAMILY.filter(n => !ppl.includes(n));
  if (missing.length) pg.append(el("p", { class: "small", style: "margin:6px 0 0", text: "Hasn't voted yet: " + missing.join(", ") }));

  // ranking
  const rk = $("#ranking"); rk.replaceChildren();
  if (!rows.length) rk.append(el("p", { class: "empty", text: "No votes yet. Rate a few activities on the Browse tab and the group ranking appears here." }));
  else {
    const tb = el("tbody");
    rows.forEach((r, i) => {
      const bars = el("div", { class: "bars", title: `${r.c[3]} must do, ${r.c[2]} would like, ${r.c[1]} maybe, ${r.c["-1"]} skip` });
      [[3, "--must"], [2, "--like"], [1, "--maybe"], ["-1", "--skip"]].forEach(([k, col]) => { if (r.c[k]) bars.append(el("span", { style: `width:${100 * r.c[k] / total}%;background:var(${col})` })) });
      tb.append(el("tr", {}, el("td", { class: "num", text: String(i + 1) }),
        el("td", {}, el("div", { text: r.a.title }), el("div", { class: "small", text: areaName(r.a.area) + (r.stars ? ` · ★ ${r.stars}` : "") }), bars),
        el("td", { class: "num", text: String(r.score) })));
    });
    rk.append(el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "#" }), el("th", { text: "Activity" }), el("th", { text: "Points", style: "text-align:right" }))), tb)));
  }

  // agreement / disagreement
  const ag = $("#agree"); ag.replaceChildren();
  const multi = rows.filter(r => r.n >= 2);
  const yes = multi.filter(r => r.c[3] >= 2 && r.c["-1"] === 0 && r.c[1] === 0 && r.c[3] === r.n).slice(0, 10);
  const split = multi.filter(r => r.c[3] >= 1 && r.c["-1"] >= 1).slice(0, 10);
  const list = (title, items, sub) => {
    const box = el("div", { class: "person" }, el("h3", { text: title }), el("p", { class: "small", style: "margin:0 0 6px", text: sub }));
    if (!items.length) box.append(el("p", { class: "small", style: "margin:0", text: "Nothing yet." }));
    else { const ul = el("ul", { class: "plain" }); items.forEach(r => ul.append(el("li", {}, el("b", { text: r.a.title }), " — " + Object.entries(r.who).map(([p, v]) => `${p}: ${labelFor(r.a, v)}`).join(", ")))); box.append(ul) }
    return box;
  };
  ag.append(list("Everyone's in", yes, "Rated Must do by everyone who voted on it."), list("Worth a family chat", split, "At least one Must do and one Skip."));

  // budget
  renderBudget(votes, rows);

  // my top 5
  const mt = $("#mytop"); mt.replaceChildren();
  if (!canWrite()) mt.append(el("p", { class: "small", style: "margin:0", text: "Pick your name at the top to choose your top 5." }));
  else if (!mine.top.length) mt.append(el("p", { class: "small", style: "margin:0", text: "Tap “Add to my top 5” on any card. Your #1 goes first; reorder here." }));
  else {
    const ol = el("ol");
    mine.top.forEach((id, i) => ol.append(el("li", {}, el("span", { class: "t", text: byId[id] ? byId[id].title : id }),
      el("button", { class: "mini", "aria-label": "Move up", disabled: i === 0, onclick: () => { [mine.top[i - 1], mine.top[i]] = [mine.top[i], mine.top[i - 1]]; queueSave(); render() }, text: "↑" }),
      el("button", { class: "mini", "aria-label": "Move down", disabled: i === mine.top.length - 1, onclick: () => { [mine.top[i + 1], mine.top[i]] = [mine.top[i], mine.top[i + 1]]; queueSave(); render() }, text: "↓" }),
      el("button", { class: "mini", "aria-label": "Remove", onclick: () => toggleTop(id), text: "✕" }))));
    mt.append(ol);
  }
  const pp = $("#people"); pp.replaceChildren();
  const withTop = ppl.filter(p => (votes[p].top || []).length);
  if (!withTop.length) pp.append(el("p", { class: "empty", text: "No one has starred a top 5 yet." }));
  for (const p of withTop) {
    const ol = el("ol", { class: "top" }); votes[p].top.forEach(id => byId[id] && ol.append(el("li", { text: byId[id].title })));
    pp.append(el("div", { class: "person" }, el("h3", { text: p + (p === me ? " (you)" : "") }), ol));
  }
  // notes
  const nt = $("#notes"); nt.replaceChildren();
  const noteRows = [];
  for (const p of ppl) for (const [aid, txt] of Object.entries(votes[p].note || {})) if ((txt || "").trim() && byId[aid]) noteRows.push({ p, aid, txt });
  if (!noteRows.length) nt.append(el("p", { class: "empty", text: "Notes people add on activity cards show up here." }));
  else for (const aid of [...new Set(noteRows.map(n => n.aid))]) {
    const box = el("div", { class: "person" }, el("h3", { text: byId[aid].title }));
    noteRows.filter(n => n.aid === aid).forEach(n => box.append(el("p", {}, el("b", { text: n.p + ": " }), n.txt)));
    nt.append(box);
  }
  // ideas
  const id = $("#ideas"); id.replaceChildren();
  const ideaRows = []; for (const p of ppl) (votes[p].ideas || []).forEach((t, i) => ideaRows.push({ p, t, i }));
  $("#ideaform").hidden = !canWrite();
  if (!ideaRows.length) id.append(el("p", { class: "small", text: "No suggestions yet." }));
  for (const r of ideaRows) id.append(el("div", { class: "row person", style: "margin-bottom:6px" },
    el("span", {}, el("b", { text: r.p + ": " }), r.t),
    r.p === me ? el("button", { class: "mini", onclick: () => { mine.ideas.splice(r.i, 1); queueSave(); render() }, text: "Remove" }) : null));
}

// ---- budget ----
const ADULT_OPTIONS = CONFIG.ADULT_OPTIONS || [{ n: CONFIG.ADULTS || CONFIG.FAMILY.length, label: "everyone" }];
let TRAVELERS = load("fg-adults", ADULT_OPTIONS[ADULT_OPTIONS.length - 1].n);
function costOf(ids) {
  let perPerson = 0, group = 0, passable = 0, extras = 0;
  const covered = id => typeof PASS !== "undefined" && PASS.covers.includes(id);
  for (const id of ids) {
    const a = byId[id]; if (!a) continue;
    if (a.budget) { if (a.perGroup) group += a.budget; else { perPerson += a.budget; if (covered(id)) passable += a.budget } }
    for (const o of a.options || []) { if (!chosen(id, o.id)) continue; extras++; if (o.perGroup) group += o.price; else { perPerson += o.price; if (o.pass) passable += o.price } }
  }
  return { perPerson, group, passable, extras, total: perPerson * TRAVELERS + group };
}
function renderBudget(votes, rows) {
  const b = $("#budget"); b.replaceChildren();
  if (ADULT_OPTIONS.length > 1) {
    const sw = el("div", { class: "filters", style: "margin:0 0 10px" });
    for (const o of ADULT_OPTIONS) sw.append(el("button", { class: "chipbtn", "aria-pressed": String(TRAVELERS === o.n), onclick: () => { TRAVELERS = o.n; store("fg-adults", o.n); render() }, text: `${o.n} adults: ${o.label}` }));
    b.append(sw, el("p", { class: "small", style: "margin:0 0 10px", text: "Switch to see what it costs if only the visitors go, or if everyone does. This choice is just for your screen." }));
  }
  const planned = [...new Set(DAYS.flatMap(d => plan.days[d] || []))];
  const musts = rows.filter(r => r.c[3] >= 1).map(r => r.a.id);
  const line = (title, ids, sub) => {
    const c = costOf(ids);
    const box = el("div", { class: "person budgetbox" }, el("h3", { text: title }), el("p", { class: "small", style: "margin:0 0 4px", text: sub }));
    if (!ids.length) { box.append(el("p", { class: "small", style: "margin:0", text: "Nothing to add up yet." })); return box }
    box.append(el("div", { class: "bigmoney", text: euro(c.total) }), el("p", { class: "small", style: "margin:2px 0 0", text: `${euro(c.perPerson)} per person × ${TRAVELERS}` + (c.group ? ` + ${euro(c.group)} shared (guide, parking)` : "") + ` · ${ids.length} items` + (c.extras ? ` · ${c.extras} paid extra${c.extras === 1 ? "" : "s"} ticked` : "") }));
    if (typeof PASS !== "undefined" && c.passable) {
      const best = PASS.prices.slice().sort((x, y) => x.price - y.price).find(p => p.price < c.passable);
      box.append(el("p", { class: "small", style: "margin:6px 0 0", text: `${euro(c.passable)} of that is at Museum Pass sites. ` + (best ? `A ${best.days}-day pass (${euro(best.price)}) would save about ${euro(c.passable - best.price)} per person if those visits fit in ${best.days} consecutive days.` : "That's less than the cheapest pass, so pay per ticket.") }));
    }
    return box;
  };
  const normandyDays = DAYS.filter(d => (plan.days[d] || []).some(id => byId[id] && byId[id].area === "normandy")).length;
  if (typeof CAR !== "undefined" && normandyDays) b.append(el("div", { class: "person budgetbox" }, el("h3", { text: "Rental car" }), el("div", { class: "bigmoney", text: euro(CAR.estimatePerDay * Math.max(3, normandyDays)) }), el("p", { class: "small", style: "margin:2px 0 0", text: `About ${euro(CAR.estimatePerDay)} a day for a 7-seat automatic, times ${Math.max(3, normandyDays)} days (minimum 3), shared. Fuel and tolls extra, roughly ${euro(CAR.fuelTolls)} for the Normandy loop.` })));
  b.append(line("The draft plan", planned, "Everything currently on the Plan tab, per-person prices times " + TRAVELERS + "."),
    line("Every Must do", musts, "Everything at least one person rated Must do or Must try."));
  if (typeof PASS !== "undefined") {
    const box = el("div", { class: "person" }, el("h3", { text: PASS.name }), el("p", { class: "small", style: "margin:0 0 6px", text: PASS.note }));
    box.append(el("p", { style: "margin:0 0 6px", text: PASS.prices.map(p => `${p.days} days ${euro(p.price)}`).join(" · ") }));
    box.append(el("p", { class: "small", style: "margin:0", text: "Covers on this list: " + PASS.covers.map(id => byId[id] ? byId[id].title : id).join(", ") + "." }));
    box.append(el("p", { class: "small", style: "margin:6px 0 0" }, el("a", { href: PASS.url, target: "_blank", rel: "noopener", text: "Official site" })));
    b.append(box);
  }
  b.append(el("p", { class: "small", style: "margin:4px 0 0", text: "Estimates only: one adult ticket per item at the main price on its card, no transport, no meals. Train trips count a round-trip fare." }));
}

// ---- planner ----
function renderPlan() {
  const root = $("#plan"); root.replaceChildren();
  const votes = allVotes(); const rows = scoreRows(votes);
  const score = Object.fromEntries(rows.map(r => [r.a.id, r]));
  const editable = canWrite();
  $("#plan-hint").textContent = editable ? "Anyone with a name picked can edit. Changes save to the shared Sheet." : "Pick your name at the top to edit the plan.";
  const planned = new Set(DAYS.flatMap(d => plan.days[d] || []));

  const grid = el("div", { class: "days" });
  for (const d of DAYS) {
    const ids = plan.days[d] || [];
    const col = el("section", { class: "day" }, el("h3", { text: fmtDayLong(d) }));
    const list = el("ul", { class: "plain daylist" });
    ids.forEach((id, i) => {
      const a = byId[id]; if (!a) return;
      const warn = closedWarning(a, d);
      const li = el("li", { class: warn ? "warn" : "" }, el("span", { class: "t" }, el("b", { text: a.title }), warn ? el("span", { class: "warnmsg", text: " ⚠ " + warn }) : null,
        el("span", { class: "small", text: " " + (a.area === "food" ? a.price : a.travel + " · " + a.time) }), a.book ? el("span", { class: "small bookmark" + ((plan.booking[id] || {}).status ? " done" : ""), text: bookBadge(id) }) : null));
      if (editable) li.append(el("span", { class: "btns" },
        el("button", { class: "mini", "aria-label": "Move up", disabled: i === 0, onclick: () => { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; queuePlanSave(); render() }, text: "↑" }),
        el("button", { class: "mini", "aria-label": "Move down", disabled: i === ids.length - 1, onclick: () => { [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; queuePlanSave(); render() }, text: "↓" }),
        el("button", { class: "mini", "aria-label": "Remove", onclick: () => { ids.splice(i, 1); plan.days[d] = ids; queuePlanSave(); render() }, text: "✕" })));
      list.append(li);
    });
    if (!ids.length) list.append(el("li", { class: "small", text: "Nothing yet" }));
    col.append(list);
    if (editable) {
      const sel = el("select", { "aria-label": "Add to " + fmtDay(d) });
      sel.append(el("option", { value: "", text: "+ Add…" }));
      for (const area of AREAS) {
        const og = el("optgroup", { label: area.name });
        VOTABLE.filter(a => a.area === area.id).sort((x, y) => (score[y.id].score - score[x.id].score) || x.title.localeCompare(y.title))
          .forEach(a => og.append(el("option", { value: a.id, text: a.title + (score[a.id].score ? ` (${score[a.id].score} pts)` : "") + (closedWarning(a, d) ? " ⚠" : "") })));
        sel.append(og);
      }
      sel.addEventListener("change", () => { if (!sel.value) return; plan.days[d] = [...(plan.days[d] || []), sel.value]; queuePlanSave(); render() });
      const note = el("input", { type: "text", class: "daynote", placeholder: "Day note, e.g. sleep in Bayeux", maxlength: "140", value: plan.note[d] || "" });
      note.addEventListener("input", () => { plan.note[d] = note.value; queuePlanSave() });
      col.append(sel, note);
    } else if (plan.note[d]) col.append(el("p", { class: "small daynote-ro", text: plan.note[d] }));
    grid.append(col);
  }
  root.append(grid);
  renderBookings(editable);
  renderCar(editable);

  // unscheduled favorites
  const un = rows.filter(r => r.score > 0 && !planned.has(r.a.id)).sort((x, y) => y.score - x.score).slice(0, 15);
  const box = el("div", { class: "panel", style: "margin-top:24px" }, el("h2", { text: "Popular but not planned yet" }),
    el("p", { class: "small", text: "Highest-scoring things that aren't on a day yet." }));
  if (!un.length) box.append(el("p", { class: "empty", text: "Everything with votes is on the plan, or no one has voted yet." }));
  else { const ul = el("ul", { class: "plain" }); un.forEach(r => ul.append(el("li", {}, el("b", { text: r.a.title }), ` — ${r.score} pts · ${areaName(r.a.area)}`))); box.append(ul) }
  root.append(box);
}

// ---- bookings ----
function renderBookings(editable) {
  const root = $("#bookings"); root.replaceChildren();
  const planned = [...new Set(DAYS.flatMap(d => plan.days[d] || []))].filter(id => byId[id] && byId[id].book);
  const order = { sellout: 0, advised: 1 };
  planned.sort((x, y) => (order[byId[x].book] - order[byId[y].book]) || plannedOn(x)[0].localeCompare(plannedOn(y)[0]));
  const open = planned.filter(id => !(plan.booking[id] || {}).status).length;
  root.append(el("div", { class: "area-head" }, el("h2", { text: "Bookings" }), el("p", { text: planned.length ? `${open} of ${planned.length} planned items still need booking. Everything not listed here is walk-up.` : "Once something that needs a ticket is on a day, it shows up here with a status." })));
  if (!planned.length) return;
  const tb = el("tbody");
  for (const id of planned) {
    const a = byId[id]; const b = plan.booking[id] || {}; const st = b.status || 0;
    const tr = el("tr", { class: st ? "booked" : "" });
    tr.append(el("td", {}, el("b", { text: a.title }), el("div", { class: "small", text: plannedOn(id).map(fmtDay).join(", ") + " · " + (a.price || "") })));
    tr.append(el("td", { class: "small" }, el("span", { class: "tag " + (a.book === "sellout" ? "xmas" : ""), text: a.book === "sellout" ? "Sells out" : "Book ahead" }), el("div", { text: BOOK_LABEL[a.book] })));
    if (editable) {
      const sel = el("select", { "aria-label": "Booking status for " + a.title });
      STATUS.forEach((t, i) => sel.append(el("option", { value: String(i), text: t })));
      sel.value = String(st);
      sel.addEventListener("change", () => { plan.booking[id] = { ...b, status: +sel.value }; queuePlanSave(); render() });
      const ref = el("input", { type: "text", class: "ref", placeholder: "Confirmation #, time slot…", maxlength: "120", value: b.ref || "" });
      ref.addEventListener("input", () => { plan.booking[id] = { ...(plan.booking[id] || {}), status: st, ref: ref.value }; queuePlanSave() });
      tr.append(el("td", {}, sel), el("td", {}, ref));
    } else tr.append(el("td", { text: STATUS[st] }), el("td", { class: "small", text: b.ref || "" }));
    tb.append(tr);
  }
  root.append(el("div", { class: "tablewrap", style: "margin-top:12px" }, el("table", { class: "booktable" }, el("thead", {}, el("tr", {}, el("th", { text: "What" }), el("th", { text: "Why" }), el("th", { text: "Status" }), el("th", { text: "Reference" }))), tb)));
}

// ---- rental car ----
function renderCar(editable) {
  const root = $("#car"); root.replaceChildren();
  if (typeof CAR === "undefined") return;
  root.append(el("div", { class: "area-head", style: "margin-top:28px" }, el("h2", { text: CAR.title }), el("p", { text: CAR.intro })));
  const tb = el("tbody");
  for (const o of CAR.options) tb.append(el("tr", {}, el("td", {}, el("a", { href: o.url, target: "_blank", rel: "noopener" }, el("b", { text: o.name })), el("div", { class: "small", text: o.where })),
    el("td", { class: "small", text: o.vehicle }), el("td", { class: "num", text: o.price }), el("td", { class: "small", text: o.notes })));
  root.append(el("div", { class: "tablewrap", style: "margin-top:12px" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "Agency" }), el("th", { text: "7-seat automatic" }), el("th", { text: "3 days, approx.", style: "text-align:right" }), el("th", { text: "Notes" }))), tb)));
  const ul = el("ul", { class: "plain", style: "margin-top:10px" }); CAR.tips.forEach(t => ul.append(el("li", { text: t }))); root.append(ul);
  root.append(el("p", { class: "small", text: CAR.checked }));
}

// ---- map ----
let map = null, mapLayer = null;
const AREA_COLORS = { paris: "#223a7a", fbl: "#2f6b4f", normandy: "#b08a3c", beyond: "#c1272d" };
function renderMap() {
  if (typeof L === "undefined") { $("#map").textContent = "The map library didn't load. Check your connection and reload."; return }
  if (!map) {
    map = L.map("map", { scrollWheelZoom: false }).setView([48.9, 1.6], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    L.circleMarker([48.4046, 2.7016], { radius: 9, color: "#1b2440", fillColor: "#fff", fillOpacity: 1, weight: 3 }).addTo(map).bindTooltip("Home: Fontainebleau", { permanent: true, direction: "right", className: "homelabel" });
    const legend = L.control({ position: "bottomleft" });
    legend.onAdd = () => { const d = L.DomUtil.create("div", "legend"); d.innerHTML = AREAS.filter(a => AREA_COLORS[a.id]).map(a => `<span><i style="background:${AREA_COLORS[a.id]}"></i>${a.name}</span>`).join(""); return d };
    legend.addTo(map);
  }
  if (mapLayer) mapLayer.remove();
  mapLayer = L.layerGroup().addTo(map);
  for (const a of ACTIVITIES) {
    if (!a.ll) continue;
    const myV = mine.r[a.id]; const on = plannedOn(a.id);
    const m = L.circleMarker(a.ll, { radius: a.closed ? 5 : 8, color: "#fff", weight: 1.5, fillColor: AREA_COLORS[a.area] || "#888", fillOpacity: a.closed ? .35 : .9 });
    m.bindPopup(`<b>${a.title}</b><br>${a.travel} from Fontainebleau · ${a.time}<br>${a.price}` + (myV != null ? `<br>You: ${labelFor(a, myV)}` : "") + (on.length ? `<br>Planned: ${on.map(fmtDay).join(", ")}` : "") + `<br><a href="#" data-jump="${a.id}">See the card</a>`);
    m.addTo(mapLayer);
  }
  setTimeout(() => map.invalidateSize(), 50);
}
function jumpTo(id) {
  if (!byId[id]) return;
  filterArea = "all"; filterTag = null; setView("browse");
  const c = document.getElementById("card-" + id); if (c) { c.scrollIntoView({ block: "center" }); c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 1600) }
}
document.addEventListener("click", e => { const j = e.target.closest("[data-jump]"); if (!j) return; e.preventDefault(); jumpTo(j.dataset.jump) });
async function copyLink(id) {
  const url = location.origin + location.pathname + "#card-" + id;
  try { await navigator.clipboard.writeText(url); flash("Link copied: " + url) } catch { prompt("Copy this link", url) }
}
function bookBadge(id) {
  const a = byId[id]; if (!a || !a.book) return "";
  const st = (plan.booking[id] || {}).status || 0;
  return st ? " · ✓ " + STATUS[st] : " · ⚑ Needs booking";
}
function countdown() {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = Math.round((dayDate(DAYS[0]) - t) / 864e5), e = Math.round((dayDate(DAYS[DAYS.length - 1]) - t) / 864e5);
  return d > 1 ? d + " days to go" : d === 1 ? "Tomorrow!" : d === 0 ? "Arrival day" : e >= 0 ? "Day " + (1 - d) + " of " + DAYS.length : "Thanks for coming";
}

// ---- phrases ----
function renderPhrases() {
  const root = $("#phrases"); if (root.childNodes.length) return;
  for (const g of PHRASES) {
    const box = el("section", { class: "phrasegroup" }, el("h2", { text: g.group }));
    if (g.note) box.append(el("p", { class: "dec", text: g.note }));
    const tb = el("tbody");
    g.items.forEach(([fr, say, en]) => tb.append(el("tr", {}, el("td", { class: "fr", text: fr }), el("td", { class: "say", text: say }), el("td", { text: en }))));
    box.append(el("div", { class: "tablewrap" }, el("table", {}, tb)));
    root.append(box);
  }
}

// ---- lightbox ----
function openLightbox(a) {
  const lb = $("#lightbox"); lb.replaceChildren(
    el("img", { src: photoSrc(a.photo, 1600), alt: a.title }),
    el("div", { class: "lbcap" }, el("b", { text: a.title }), " · ", el("a", { href: photoPage(a.photo), target: "_blank", rel: "noopener", text: "Photo: Wikimedia Commons" })));
  lb.hidden = false; document.body.style.overflow = "hidden";
}
function closeLightbox() { $("#lightbox").hidden = true; document.body.style.overflow = "" }
$("#lightbox").addEventListener("click", closeLightbox);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLightbox() });

// ---- views ----
const VIEWS = ["browse", "results", "plan", "map", "phrases"];
let view = "browse";
function render() {
  renderWho();
  if (view === "browse") renderBrowse();
  else if (view === "results") renderResults();
  else if (view === "plan") renderPlan();
  else if (view === "map") renderMap();
  else if (view === "phrases") renderPhrases();
}
function setView(v) {
  if (!VIEWS.includes(v)) v = "browse";
  view = v; store("fg-view", v);
  for (const x of VIEWS) { $("#view-" + x).hidden = v !== x; $("#tab-" + x).setAttribute("aria-selected", String(v === x)) }
  render();
}
for (const x of VIEWS) $("#tab-" + x).onclick = () => setView(x);
$("#ideaform").addEventListener("submit", e => {
  e.preventDefault(); const inp = $("#ideainput"); const t = inp.value.trim();
  if (!t || !canWrite()) return; mine.ideas.push(t); inp.value = ""; queueSave(); render();
});

// ---- boot ----
(async () => {
  if (!ONLINE) { baseNotice = "Preview mode: votes save only in this browser until the Google Sheet is connected in config.js."; $("#notice").textContent = baseNotice; $("#notice").hidden = false }
  $("#countdown").textContent = " · " + countdown();
  setView(load("fg-view", "browse"));
  setStatus("Loading votes…");
  const ok = await fetchAll();
  if (me && all[me]) mine = clone({ ...blank(), ...all[me] });
  setStatus(!ok ? "Couldn't load votes. Reload to try again." : me ? "Voting as " + me : "Pick your name to vote", ok && !!me);
  render();
  if (location.hash.startsWith("#card-")) setTimeout(() => jumpTo(location.hash.slice(6)), 100);
  window.addEventListener("hashchange", () => { if (location.hash.startsWith("#card-")) jumpTo(location.hash.slice(6)) });
  // pick up everyone else's votes and plan edits every 30 seconds (skip while typing)
  if (ONLINE) setInterval(async () => {
    if (dirty || planDirty || document.hidden) return;
    const ae = document.activeElement;
    if (!(await fetchAll())) return;
    if (me) all[me] = clone(mine);
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" || ae.tagName === "SELECT")) return;
    render();
  }, 30000);
})();
