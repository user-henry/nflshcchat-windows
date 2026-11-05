**English** | [简体中文](README.md)

# NFLSHC Chat · Windows Desktop (developer documentation)

The Windows desktop client of NFLSHC Chat (the student chat platform of Nanjing Foreign Language School Huai'an Campus): built on **Electron + vanilla HTML/CSS/JS** (no frontend framework, no bundler), reusing NFLSHC Chat's **Cloudflare Workers + D1** backend, packaged and auto-updated via **electron-builder + electron-updater**.

| | |
|---|---|
| Current version | **v2.5.0** (`version` in `package.json`) |
| Default branch | `master` (this repository does not use `main`) |
| Tags / releases | `v2.4.0`, `v2.5.0`; installers on [GitHub Releases](https://github.com/user-henry/nflshcchat-windows/releases) |
| Main site / backend | https://nflshcchat.cc.cd · API `https://worker.nflshcchat.cc.cd` |
| Website (download page) | https://home.nflshcchat.cc.cd (repository [nflshcchat-home](https://github.com/user-henry/nflshcchat-home)) |

> For end-user installation and FAQs, see the website and help documentation: https://help.nflshcchat.cc.cd

---

## 1. Environment and commands

| Item | Requirement |
|---|---|
| OS | Windows 10+ / x64 (only Windows is a packaging target) |
| Node.js | 18+, 20 LTS recommended (`npm` included) |
| Dependencies | `electron ^31.7.7`, `electron-builder ^24.13.3`, `electron-updater ^6.3.9` |

`package.json` already configures a China mirror (`electronDownload.mirror = https://registry.npmmirror.com/-/binary/electron/`), so `npm install` works without manually setting a mirror on Chinese networks.

```bash
npm install          # Install dependencies
npm start            # Start in development mode (equivalent to electron .)

build.bat            # One-click build (runs the command below)
npx electron-builder --win nsis portable --x64
```

Artifacts are written to `dist/`:

| File | Description |
|---|---|
| `NFLSHC-Chat-<version>-Setup.exe` | NSIS installer (`oneClick:false`, install directory selectable; **supports auto-update**) |
| `NFLSHC-Chat-<version>-Setup.exe.blockmap` | Differential-update index (must be uploaded with each release) |
| `latest.yml` | Auto-update manifest (must be uploaded with each release) |
| `NFLSHC-Chat-<version>-Portable.exe` | Portable build (**no auto-update**; see §5) |

Updates are not checked in development mode (skipped when `app.isPackaged === false`), so a missing `app-update.yml` does not cause errors.

---

## 2. Directory structure

```
main.js                    Main process: windows, IPC, local data, export, native dialogs, system wallpaper, auto-update
preload.js                 contextBridge exposes window.electronAPI (the renderer's only privileged entry point)
pages/
  index.html               Main UI: login / register / password recovery / chat (imports the modules below)
  config.js                Runtime configuration: API URLs, EmailJS, AI bot, logo
  utils.js                 window.NFLSHC global state + helpers (escaping, levels, time, toast, modals, page switching)
  github-api.js            Data-layer adapter GITHUB_API: auth + record CRUD (via /api/legacy/issues)
  auth.js                  Login / register / logout / auto-login / password recovery (SHA-256 + email code)
  chat-room.js             Chat rooms: list, create, settings, join
  messages.js              Messages: paginated loading, incremental polling, rendering, Markdown, recall / favorite / pin
  notifications.js         Notifications: system notices, @mentions, friend requests, unread badges, announcements
  profile.js               Profile, edit profile, friends, bot profile card
  admin.js                 Admin console: user management, bans, announcements, usage stats, suggestion handling
  ai-bot.js                AI bot (Sizhi API), replies based on trigger words
  favorites-export.js      Favorites management and data export (JSON / HTML)
  wallpaper.js             Bing daily image: in-app background + actually changing the system wallpaper
  updater.js / updater.css Auto-update UI (bottom-right pill + floating card)
  app.js                   Entry: initApp / initChat
  styles.css               All styles (including theme variables)
assets/                    icon.ico / icon.png / icon.svg
build.bat                  One-click Windows build script
_build.js                  Build helper (cleans dist, builds portable and nsis separately; legacy)
generate-icon.js           SVG → PNG icon generation
generate-icon-png.js       Multi-size PNG generation
_makeico.py                PNG → multi-size ICO generation
LICENSE.txt                License
```

`main.js` is only about 600 lines, and the renderer attaches business files to globals one by one — **there is no module bundler**: save your changes and restart with `npm start`, no compile step.

---

## 3. Process model and IPC

The main process creates windows with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: false`; pages can only access system capabilities through `window.electronAPI` exposed by `preload.js` (external links always use `shell.openExternal`, never opening a new in-app window).

| `electronAPI` method | Channel | Purpose |
|---|---|---|
| `getUserDataPath()` | `get-user-data-path` | Returns the `<user data>/data` directory |
| `saveLocalData` / `loadLocalData` / `deleteLocalData` | `save-local-data` / `load-local-data` / `delete-local-data` | Read/write `<user data>/data/<file>.json` |
| `exportData({content, format})` | `export-data` | Native "Save as" dialog, then write the file |
| `showMessageBox(options)` | `show-message-box` | Native message box |
| `minimizeWindow` / `maximizeWindow` / `closeWindow` / `isMaximized` | `minimize-window` / `maximize-window` / `close-window` / `is-maximized` | Window controls |
| `onWindowStateChanged(cb)` | `window-state-changed` | Maximize / restore events |
| `saveWallpaperTemp(buffer, name)` | `wallpaper-save-temp` | Write the wallpaper image to `<user data>/wallpaper/` |
| `setWallpaper(localPath)` | `wallpaper-set` | Actually change the system desktop wallpaper (PowerShell + `SystemParametersInfo` on Windows) |
| `onUpdateStatus(cb)` | `update-status` | Subscribe to update status (returns an unsubscribe function) |
| `checkForUpdates()` / `installUpdate()` / `getUpdateState()` | `update:check` / `update:install` / `update:get-state` | Manual check / restart and install / fetch current state |

On-disk locations (typically `%APPDATA%\nflshc-chat\` on Windows):

```
data\*.json       Locally cached data (read/written via IPC)
wallpaper\        Wallpaper images and set_wp.ps1
update.log        Auto-update log (check this first when debugging updates)
```

---

## 4. Data layer and authentication

The renderer **does not connect to GitHub directly**: all record reads/writes go through `GITHUB_API` in `pages/github-api.js` (the filename is a legacy name), which points at the **legacy issues compatibility layer** of `CONFIG.API_BASE` (`https://worker.nflshcchat.cc.cd`) — each business record is stored as an "Issue" in D1:

```
GET/POST        /api/legacy/issues            list / create
GET/PATCH       /api/legacy/issues/<number>   read / update / close
```

- Record body format: `title` + a ` ```json … ``` ` code block; `parseJsonFromIssue()` parses it and `buildIssueBody()` builds it.
- Business types are distinguished by `labels`: `user`, `chatroom`, `chatmessage`, `favorite`, `friend`, `friend_request`, `system_notification`, `broadcast`, `suggestion`.
- Auth: `localStorage['nflshc_token']` (`getToken` / `setToken` / `clearToken`) is sent as the `Authorization: Bearer` header; the token is issued by the login endpoint, and a 401 means the session has expired.

Authentication endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login` | Login (the frontend hashes with **SHA-256** first, then sends `password`) |
| `POST /api/auth/logout` | Logout (also clears the token) |
| `GET  /api/auth/me` | Auto-login check (`checkAutoLogin`) |
| `POST /api/auth/forgot` | Send a password-recovery code (carries the EmailJS service / template / public key; the Worker sends the email) |
| `POST /api/auth/verify-reset` | Verify the code and exchange it for a reset credential |

Password-recovery codes go through **EmailJS** (`index.html` loads `@emailjs/browser` from jsdelivr); `EMAILJS_CONFIG` in `config.js` is a public browser-side configuration. **Note:** this public key + service/template combination can be abused by others to consume your EmailJS quota — enable domain allowlisting and rate limits in the EmailJS console; never put the private key (`apiKey`) in the frontend.

`utils.js` defines the application-level global state `window.NFLSHC` (`currentUser`, `currentRoom`, `allRooms`, `allMessages`, `pollInterval`…) and shared helpers (`escapeHtml`, `showToast`, `showModal`, `showPage`, `formatTime`, `calculateLevel`). The level formula matches the web client: `level = floor(sqrt(xp / 10)) + 1`.

---

## 5. Auto-update (electron-updater)

Implementation highlights (auto-update section of `main.js`):

- **Only effective in the packaged NSIS build**: `app.isPackaged === false` (development mode), portable builds and non-Windows platforms are skipped, with the reason reported back to the UI.
- **Why portable builds do not support it**: each run extracts to a temporary directory, so there is no installation location to replace. The main process detects `PORTABLE_EXECUTABLE_DIR` / `PORTABLE_EXECUTABLE_FILE` / `PORTABLE_EXECUTABLE_APP_FILENAME` and skips, telling the user to download the new version manually.
- Automatically checks **8 seconds** after launch; the user can also click "Check for updates".
- `autoDownload = true`: downloads new versions automatically; `autoInstallOnAppQuit = true`: installs silently on normal exit. **It never forces a restart after download** — the user clicks "Restart and install", which calls `quitAndInstall(false, true)`.
- Any exception is swallowed: no native error boxes, the main process never crashes; it only writes `update.log` and reports the state.

State machine (`updateState.state`) and its electron-updater event mapping:

| state | Event | Example UI text |
|---|---|---|
| `idle` | Initialization complete | Auto-update ready |
| `disabled` | Dev mode / portable / non-Windows | Portable builds do not support auto-update; download the new installer and replace manually |
| `checking` | `checking-for-update` | Checking for updates… |
| `available` | `update-available` | New version vX.Y.Z found, downloading… |
| `downloading` | `download-progress` | Downloading update 42% |
| `downloaded` | `update-downloaded` | vX.Y.Z downloaded; restart to apply |
| `not-available` | `update-not-available` | You are on the latest version |
| `error` | `error` | Update check failed: <reason> |

UI (`pages/updater.js` + `updater.css`): a permanent pill `#updatePill` in the bottom-right corner (shows the current version, click to expand) and a floating card `#updateCard` (version, state, progress bar, two buttons). Styles reuse the theme variables from `styles.css` and load no external resources.

### Release process

1. Bump `version` in `package.json` (it must match the tag, e.g. `2.5.0` ↔ `v2.5.0`).
2. Build with `build.bat`; artifacts land in `dist/`.
3. Upload these three files to a **published (not draft)** Release (the portable build is optional):
   - `NFLSHC-Chat-<version>-Setup.exe`
   - `NFLSHC-Chat-<version>-Setup.exe.blockmap`
   - `latest.yml`
4. The `version` in `latest.yml` must be strictly greater than the client's current version for the client to offer the update; old clients only read "the newest Release".

> **The filename must match in all three places**: the name recorded in `latest.yml`, the actual filename in the Release, and the artifact name in `dist/`. electron-builder's default artifact names contain spaces (`NFLSHC Chat-2.5.0-Setup.exe`), and GitHub replaces spaces with `.` on upload, so the three no longer match → clients get a 404. This repository fixes it once and for all with hyphenated `artifactName` entries in `package.json`:
> ```json
> "nsis":     { "artifactName": "NFLSHC-Chat-${version}-Setup.${ext}" },
> "portable": { "artifactName": "NFLSHC-Chat-${version}-Portable.${ext}" }
> ```
> (Release assets for v2.4.0 and earlier use the `NFLSHC.Chat-…` form; update hard-coded old links on the website if necessary.)

`build.publish` in `package.json` only declares `provider/owner/repo` and **contains no token**; its purpose is to generate `resources/app-update.yml` during packaging so electron-updater knows where to check. Day-to-day releases can be uploaded manually as described above. For CLI publishing, use an environment variable (never commit it):

```powershell
$env:GH_TOKEN = "<your GitHub token>"
npx electron-builder --win nsis portable --x64 --publish always
```

---

## 6. Common pitfalls

| Symptom | Cause / fix |
|---|---|
| The client always says "you are on the latest version" | `latest.yml`'s `version` is not greater than the client version; or `package.json` `version` was not bumped before packaging |
| Update check fails / 404 | The Release is a draft; `latest.yml` is missing; or filenames do not match (see §5) |
| The portable build never offers updates | By design; the UI explains why |
| Need failure details | `%APPDATA%\nflshc-chat\update.log` |
| No update prompt in development mode | By design; skipped when `app.isPackaged` is false |
| Images/icons in the repository are corrupted | Binary uploads must go through base64 (Contents API) or git — **never through a text-processing channel**. `assets/icon.ico` and `assets/icon.png` in this repository were once corrupted this way (the first PNG byte replaced with U+FFFD, illegal ICO directory table), fixed in the v2.5.0 commits. After replacing icons, verify the file headers (PNG `89 50 4E 47`, ICO `00 00 01 00`) |
| `.gitignore` lists `_build.js` but the file is in the repository | The file was already tracked before being added to `.gitignore`; ignore rules do not apply to tracked files, so it stays in the repository |
| The branch is not `main` | This repository's default branch is **`master`** — do not push to `main` |

`.gitignore` already excludes: `node_modules/`, `dist/`, `*.exe`, `*.zip`, `_*.log`, `_*.ps1`, `_debug.js`, `_publish.*`. Before committing, make sure no tokens, passwords or temporary release scripts have been included.

---

## 7. Icons

```
generate-icon.js        → generate PNG from assets/icon.svg
generate-icon-png.js    → generate PNGs at multiple sizes
_makeico.py             → pack into a multi-size assets/icon.ico (16/32/48/64/128/256)
```

The icon used for packaging is set by `build.win.icon` in `package.json` (`assets/icon.ico`). After replacing the icon, rebuild once and confirm the taskbar, installer and uninstaller icons all look right.

---

## 8. Related repositories

| Repository | Description |
|---|---|
| [nflshcchat](https://github.com/user-henry/nflshcchat) | Main site frontend and unified backend (Cloudflare Worker + D1) |
| [nflshcchat-home](https://github.com/user-henry/nflshcchat-home) | Official website / download page (home.nflshcchat.cc.cd) |
| [chatai](https://github.com/user-henry/chatai) | HZYAI intelligent assistant (chatai.bot.cd) |
| [nflshcchat-platform](https://github.com/user-henry/nflshcchat-platform) | Developer platform |
| [nflshcchat-accounts](https://github.com/user-henry/nflshcchat-accounts) | Account authorization center |
| [help-nflshc202401](https://github.com/user-henry/help-nflshc202401) | Help documentation site |

---

## 9. License

See [LICENSE.txt](LICENSE.txt).
