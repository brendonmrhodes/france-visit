# Fontainebleau Family Visit

A small website listing everything the family could do during the 10–22 December 2026 visit. Everyone picks their name, rates each activity, stars a top 5 and leaves notes. Votes are saved to a Google Sheet that you own.

## What's in this folder

| File | What it is | Edit it? |
|---|---|---|
| `index.html` | The page | Rarely |
| `activities.js` | The list of activities, photos and December notes | Yes, this is where you add or change things |
| `config.js` | Family names and the Google Sheet link | Yes, once during setup |
| `style.css`, `app.js` | Look and behavior | No |
| `google-sheet/Code.gs` | The script that saves votes into your Sheet | Paste it once during setup |

Open `index.html` in your browser to preview. Until `config.js` has the Sheet link, votes are saved only in that browser.

## Setup (about 15 minutes)

### 1. Make the Google Sheet that stores votes
1. Go to sheets.google.com and create a blank spreadsheet. Name it something like "Family visit votes".
2. In the menu choose **Extensions → Apps Script**.
3. Delete what's in the editor, paste in all of `google-sheet/Code.gs`, and click **Save**.
4. Click **Deploy → New deployment**. Click the gear next to "Select type" and pick **Web app**.
5. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**.
6. Google asks you to authorize. Choose your account. If you see "Google hasn't verified this app", click **Advanced → Go to (project name)**. It's your own script, so this is expected.
7. Copy the **Web app URL** (it ends in `/exec`).

### 2. Point the site at the Sheet
Open `config.js` and paste the URL between the quotes on the `SCRIPT_URL` line. Change the `FAMILY` names to the real ones.

### 3. Put the site online with GitHub Pages
1. On github.com, click **New repository**. Name it, for example, `france-visit`. Choose **Public** (free Pages needs a public repo on a free account). Create it.
2. Click **Add file → Upload files**, drag in everything from this folder (keep the `google-sheet` folder too, it's harmless), and click **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", set **Source: Deploy from a branch**, branch **main**, folder **/ (root)**. Click **Save**.
4. After a minute the page shows your site address, like `https://YOUR-NAME.github.io/france-visit/`. Send that link to the family.

## Making changes later
- Edit `activities.js` (or ask Claude to), then upload the new file to the repo. The site updates in about a minute. Votes are kept, because they live in the Sheet.
- To change an activity's photo, find a picture on commons.wikimedia.org, open it, and copy the part of its address after `File:` into that activity's `photo:` field.
- If you change `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## Good to know
- Anyone with the link can vote under any name on the list. That's fine for family, but don't post the link publicly.
- The **Summary** tab in the Sheet shows every vote in plain rows, so you can sort and filter there too.
- Photos come from Wikimedia Commons and are freely licensed. Each photo's "Photo: Wikimedia Commons" credit links to its page with the photographer and license.
