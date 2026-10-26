/* App logic. You shouldn't need to edit this file: activities live in activities.js, settings in config.js. */
const RATINGS = [ { v: 3, label: "Must do" }, { v: 2, label: "Would like" }, { v: 1, label: "Maybe" }, { v: -1, label: "Skip" } ];
const RATINGS_FOOD = [ { v: 3, label: "Must try" }, { v: 2, label: "Would try" }, { v: 1, label: "Maybe" }, { v: -1, label: "Pass" } ];
const ratingsFor = a => a.area === "food" ? RATINGS_FOOD : RATINGS;
const labelFor = (a, v) => (ratingsFor(a).find(r => r.v === v) || {}).label || "";
const byId = Object.fromEntries(ACTIVITIES.map(a => [a.id, a]));
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
const photoSrc = f => "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(f) + "?width=640";
const photoPage = f => "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(f);

function load(key, fb) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb } catch { return fb } }
function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }

// ---- state ----
const ONLINE = !!(CONFIG.SCRIPT_URL || "").trim();
const blank = () => ({ r: {}, note: {}, top: [], ideas: [] });
let me = load("fg-me", "");            // the family name this browser votes as
let mine = blank();
let all = {};                          // name -> vote data
let filterArea = "all", filterTag = null;
let openNotes = new Set();
const canWrite = () => !!me;

// ---- server ----
async function fetchAll() {
  if (!ONLINE) { all = load("fg-local-votes", {}); return true }
  try {
    const res = await fetch(CONFIG.SCRIPT_URL, { cache: "no-store" });
    const j = await res.json();
    if (j.ok) { all = j.votes || {}; return true }
  } catch {}
  return false;
}
async function pushMine() {
  if (!ONLINE) { const l = load("fg-local-votes", {}); l[me] = mine; store("fg-local-votes", l); return { ok: true } }
  const res = await fetch(CONFIG.SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ name: me, data: mine }) });
  return res.json();
}

// ---- saving (one request at a time, debounced) ----
let saveTimer = null, saving = Promise.resolve(), dirty = false;
function setStatus(t, ok) { $("#status").textContent = t; $("#savedot").classList.toggle("ok", !!ok) }
function queueSave() {
  if (!canWrite()) return;
  dirty = true; setStatus("Saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saving = saving.then(async () => {
      if (!dirty) return; dirty = false;
      try {
        const j = await pushMine();
        if (j && j.ok) { all[me] = JSON.parse(JSON.stringify(mine)); setStatus(ONLINE ? "Saved" : "Saved on this device only", true) }
        else setStatus("Couldn't save. Try again in a moment.");
      } catch { setStatus("Couldn't save. Check your connection.") }
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
    mine = me && all[me] ? JSON.parse(JSON.stringify({ ...blank(), ...all[me] })) : blank();
    setStatus(me ? "Voting as " + me : "Pick your name to vote", !!me);
    render();
  });
  w.prepend(el("label", { for: "me", text: "I'm" }), sel);
}

// ---- rendering ----
function renderFilters() {
  const f = $("#filters"); f.replaceChildren();
  const mk = (label, pressed, on) => el("button", { class: "chipbtn", "aria-pressed": String(pressed), onclick: on, text: label });
  f.append(mk("Everything", filterArea === "all", () => { filterArea = "all"; render() }));
  for (const a of AREAS) f.append(mk(a.name, filterArea === a.id, () => { filterArea = a.id; render() }));
  f.append(el("span", { class: "sep" }));
  for (const [k, label] of Object.entries(TAGS)) f.append(mk(label, filterTag === k, () => { filterTag = filterTag === k ? null : k; render() }));
  f.append(mk("Not rated by me", filterTag === "unrated", () => { filterTag = filterTag === "unrated" ? null : "unrated"; render() }));
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
  fig.append(img, el("a", { class: "credit", href: photoPage(a.photo), target: "_blank", rel: "noopener", text: "Photo: Wikimedia Commons" }));
  return fig;
}

function card(a) {
  const myV = mine.r[a.id]; const starred = mine.top.includes(a.id);
  const tags = el("div", { class: "tags" });
  if (a.closed) tags.append(el("span", { class: "tag closedtag", text: "Not open in December" }));
  for (const t of a.tags) tags.append(el("span", { class: "tag" + (t === "ww2" ? " ww2" : t === "xmas" ? " xmas" : ""), text: TAGS[t] || t }));
  const food = a.area === "food";
  const meta = food
    ? el("div", { class: "meta" }, el("span", { text: a.origin }), el("span", { class: "price", text: a.price }))
    : el("div", { class: "meta" },
      el("span", { text: "From Fontainebleau: " + a.travel }), el("span", { text: "Time: " + a.time }),
      a.closedDays ? el("span", { text: a.closedDays }) : null,
      el("span", { class: "price", text: a.price || a.cost }));
  const c = el("article", { class: "card" + (a.closed ? " closed" : "") }, photo(a),
    el("h3", { text: a.title }), meta, el("p", { class: "blurb", text: a.blurb }),
    food ? el("p", { class: "dec" }, el("b", { text: "Where: " }), a.where) : el("p", { class: "dec" }, el("b", { text: "In December: " }), a.dec), tags);
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
      food ? null : el("a", { class: "linkish", href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a.title + " France"), target: "_blank", rel: "noopener", text: "Map" })));
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
    else if (filterTag) items = items.filter(a => a.tags.includes(filterTag));
    if (!items.length) continue;
    const grid = el("div", { class: "grid" }); items.forEach(a => grid.append(card(a)));
    root.append(el("section", { class: "area", id: "area-" + area.id },
      el("div", { class: "area-head" }, el("h2", { text: area.name }), el("p", { text: area.note })), grid));
  }
  if (!root.childNodes.length) root.append(el("p", { class: "empty", text: "Nothing matches these filters." }));
}

function renderResults() {
  const votes = { ...all }; if (me) votes[me] = mine;
  const people = Object.keys(votes);
  const rows = ACTIVITIES.filter(a => !a.closed).map(a => {
    const c = { 3: 0, 2: 0, 1: 0, "-1": 0 }; let score = 0, stars = 0;
    for (const p of people) { const d = votes[p]; const v = d.r && d.r[a.id]; if (v != null) { c[v]++; score += v } if ((d.top || []).includes(a.id)) { stars++; score += 2 } }
    return { a, c, score, stars, n: c[3] + c[2] + c[1] + c["-1"] };
  }).filter(r => r.n || r.stars).sort((x, y) => y.score - x.score || y.c[3] - x.c[3]);
  const rk = $("#ranking"); rk.replaceChildren();
  if (!rows.length) rk.append(el("p", { class: "empty", text: "No votes yet. Rate a few activities on the Browse tab and the group ranking appears here." }));
  else {
    const tb = el("tbody");
    rows.forEach((r, i) => {
      const total = Math.max(1, people.length);
      const bars = el("div", { class: "bars", title: `${r.c[3]} must do, ${r.c[2]} would like, ${r.c[1]} maybe, ${r.c["-1"]} skip` });
      [[3, "--must"], [2, "--like"], [1, "--maybe"], ["-1", "--skip"]].forEach(([k, col]) => { if (r.c[k]) bars.append(el("span", { style: `width:${100 * r.c[k] / total}%;background:var(${col})` })) });
      tb.append(el("tr", {}, el("td", { class: "num", text: String(i + 1) }),
        el("td", {}, el("div", { text: r.a.title }), el("div", { class: "small", text: AREAS.find(x => x.id === r.a.area).name + (r.stars ? ` · ★ ${r.stars}` : "") }), bars),
        el("td", { class: "num", text: String(r.score) })));
    });
    rk.append(el("div", { class: "tablewrap" }, el("table", {}, el("thead", {}, el("tr", {}, el("th", { text: "#" }), el("th", { text: "Activity" }), el("th", { text: "Points", style: "text-align:right" }))), tb)));
  }
  const nt = $("#notes"); nt.replaceChildren();
  const noteRows = [];
  for (const p of people) for (const [aid, txt] of Object.entries(votes[p].note || {})) if ((txt || "").trim() && byId[aid]) noteRows.push({ p, aid, txt });
  if (!noteRows.length) nt.append(el("p", { class: "empty", text: "Notes people add on activity cards show up here." }));
  else for (const aid of [...new Set(noteRows.map(n => n.aid))]) {
    const box = el("div", { class: "person" }, el("h3", { text: byId[aid].title }));
    noteRows.filter(n => n.aid === aid).forEach(n => box.append(el("p", {}, el("b", { text: n.p + ": " }), n.txt)));
    nt.append(box);
  }
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
  const withTop = people.filter(p => (votes[p].top || []).length);
  if (!withTop.length) pp.append(el("p", { class: "empty", text: "No one has starred a top 5 yet." }));
  for (const p of withTop) {
    const ol = el("ol", { class: "top" }); votes[p].top.forEach(id => byId[id] && ol.append(el("li", { text: byId[id].title })));
    pp.append(el("div", { class: "person" }, el("h3", { text: p + (p === me ? " (you)" : "") }), ol));
  }
  const id = $("#ideas"); id.replaceChildren();
  const ideaRows = []; for (const p of people) (votes[p].ideas || []).forEach((t, i) => ideaRows.push({ p, t, i }));
  $("#ideaform").hidden = !canWrite();
  if (!ideaRows.length) id.append(el("p", { class: "small", text: "No suggestions yet." }));
  for (const r of ideaRows) id.append(el("div", { class: "row person", style: "margin-bottom:6px" },
    el("span", {}, el("b", { text: r.p + ": " }), r.t),
    r.p === me ? el("button", { class: "mini", onclick: () => { mine.ideas.splice(r.i, 1); queueSave(); render() }, text: "Remove" }) : null));
}

let view = "browse";
function render() {
  renderWho();
  if (view === "browse") renderBrowse(); else renderResults();
}
function setView(v) {
  view = v; store("fg-view", v);
  $("#view-browse").hidden = v !== "browse"; $("#view-results").hidden = v !== "results";
  $("#tab-browse").setAttribute("aria-selected", String(v === "browse")); $("#tab-results").setAttribute("aria-selected", String(v === "results"));
  render();
}
$("#tab-browse").onclick = () => setView("browse");
$("#tab-results").onclick = () => setView("results");
$("#ideaform").addEventListener("submit", e => {
  e.preventDefault(); const inp = $("#ideainput"); const t = inp.value.trim();
  if (!t || !canWrite()) return; mine.ideas.push(t); inp.value = ""; queueSave(); render();
});

// ---- boot ----
(async () => {
  if (!ONLINE) { baseNotice = "Preview mode: votes save only in this browser until the Google Sheet is connected in config.js."; $("#notice").textContent = baseNotice; $("#notice").hidden = false }
  setView(load("fg-view", "browse") === "results" ? "results" : "browse");
  setStatus("Loading votes…");
  const ok = await fetchAll();
  if (me && all[me]) mine = JSON.parse(JSON.stringify({ ...blank(), ...all[me] }));
  setStatus(!ok ? "Couldn't load votes. Reload to try again." : me ? "Voting as " + me : "Pick your name to vote", ok && !!me);
  render();
  // pick up everyone else's votes every 30 seconds (skip while typing)
  if (ONLINE) setInterval(async () => {
    if (dirty || document.hidden) return;
    const ae = document.activeElement;
    if (!(await fetchAll())) return;
    if (me) all[me] = JSON.parse(JSON.stringify(mine));
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) return;
    render();
  }, 30000);
})();
