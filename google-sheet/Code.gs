/**
 * Saves family votes for the Fontainebleau visit guide into this Google Sheet.
 * Paste into Extensions > Apps Script, then Deploy > New deployment > Web app
 * (Execute as: Me, Who has access: Anyone). Copy the /exec URL into config.js.
 *
 * Each person gets one row on the "Votes" tab: name | their votes as JSON | last saved.
 * The "Summary" tab is rebuilt on every save so you can read the votes without the site.
 */
const SHEET_NAME = 'Votes';
const RATING_LABELS = { '3': 'Must do', '2': 'Would like', '1': 'Maybe', '-1': 'Skip' };

function votesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readVotes_() {
  const votes = {};
  votesSheet_().getDataRange().getValues().forEach(function (row) {
    if (!row[0] || !row[1]) return;
    try { votes[String(row[0])] = JSON.parse(row[1]); } catch (err) { /* skip a damaged row */ }
  });
  return votes;
}

function doGet() {
  return json_({ ok: true, votes: readVotes_() });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  const name = String(body.name || '').trim().slice(0, 40);
  if (!name) return json_({ ok: false, error: 'no_name' });
  const data = JSON.stringify(body.data || {});
  if (data.length > 45000) return json_({ ok: false, error: 'too_big' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = votesSheet_();
    const names = sheet.getDataRange().getValues().map(function (r) { return String(r[0]); });
    const i = names.indexOf(name);
    const row = [name, data, new Date()];
    if (i >= 0 && names[i]) sheet.getRange(i + 1, 1, 1, 3).setValues([row]);
    else sheet.appendRow(row);
    writeSummary_();
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

/** A readable tab: one row per person per activity they rated or starred. */
function writeSummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
  const rows = [['Person', 'Activity id', 'Rating', 'Top 5 rank', 'Note']];
  const votes = readVotes_();
  Object.keys(votes).forEach(function (person) {
    const v = votes[person] || {};
    const r = v.r || {}, note = v.note || {}, top = v.top || [];
    const ids = {};
    Object.keys(r).concat(top, Object.keys(note)).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      const rank = top.indexOf(id);
      rows.push([person, id, RATING_LABELS[String(r[id])] || '', rank >= 0 ? rank + 1 : '', note[id] || '']);
    });
    (v.ideas || []).forEach(function (idea) { rows.push([person, '(suggestion)', '', '', idea]); });
  });
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
}
