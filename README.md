# NFLSHC Chat · Windows 桌面端（开发者文档）

NFLSHC Chat（南京外国语学校淮安分校学生聊天平台）的 Windows 桌面客户端：基于 **Electron + 原生 HTML/CSS/JS**（无前端框架、无打包器），后端复用 NFLSHC Chat 的 **Cloudflare Workers + D1**，并通过 **electron-builder + electron-updater** 打包与自动更新。

| | |
|---|---|
| 当前版本 | **v2.5.0**（`package.json` 的 `version`） |
| 默认分支 | `master`（本仓库不使用 `main`） |
| 标签 / 发布 | `v2.4.0`、`v2.5.0`；安装包在 [GitHub Releases](https://github.com/user-henry/nflshcchat-windows/releases) |
| 主站 / 后端 | https://nflshcchat.cc.cd ・ API `https://worker.nflshcchat.cc.cd` |
| 官网（下载页） | https://home.nflshcchat.cc.cd（仓库 [nflshcchat-home](https://github.com/user-henry/nflshcchat-home)） |

> 面向使用者的安装与常见问题请看官网与帮助文档：https://help.nflshcchat.cc.cd

---

## 1. 环境与命令

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10+ / x64（打包目标只有 Windows） |
| Node.js | 18 以上，建议 20 LTS（`npm` 随附） |
| 依赖 | `electron ^31.7.7`、`electron-builder ^24.13.3`、`electron-updater ^6.3.9` |

`package.json` 里已经配好国内镜像（`electronDownload.mirror = https://registry.npmmirror.com/-/binary/electron/`），国内网络下 `npm install` 不必再手动设镜像。

```bash
npm install          # 安装依赖
npm start            # 开发模式启动（等价于 electron .）

build.bat            # 一键打包（内容就是下面这条命令）
npx electron-builder --win nsis portable --x64
```

产物在 `dist/`：

| 文件 | 说明 |
|---|---|
| `NFLSHC-Chat-<版本>-Setup.exe` | NSIS 安装包（`oneClick:false`，可自选安装目录；**支持自动更新**） |
| `NFLSHC-Chat-<版本>-Setup.exe.blockmap` | 差量更新索引（发版时必须上传） |
| `latest.yml` | 自动更新描述文件（发版时必须上传） |
| `NFLSHC-Chat-<版本>-Portable.exe` | 便携版（**不支持自动更新**，见 §5） |

开发模式下不会检查更新（`app.isPackaged === false` 时直接跳过），因此不会因为缺少 `app-update.yml` 而报错。

---

## 2. 目录结构

```
main.js                    主进程：窗口、IPC、本地数据、导出、原生对话框、系统壁纸、自动更新
preload.js                 contextBridge 暴露 window.electronAPI（渲染进程唯一的特权入口）
pages/
  index.html               主界面：登录 / 注册 / 找回密码 / 聊天（引入下方各模块）
  config.js                运行期配置：API 地址、EmailJS、AI 机器人、Logo
  utils.js                 window.NFLSHC 全局状态 + 工具函数（转义、等级、时间、toast、模态、页面切换）
  github-api.js            数据层适配器 GITHUB_API：认证 + 记录 CRUD（走 /api/legacy/issues）
  auth.js                  登录 / 注册 / 注销 / 自动登录 / 找回密码（SHA-256 + 邮箱验证码）
  chat-room.js             聊天室：列表、创建、设置、加入
  messages.js              消息：分页加载、增量轮询、渲染、Markdown、撤回 / 收藏 / 置顶
  notifications.js         通知：系统通知、@提及、好友申请、未读角标、公告
  profile.js               个人资料、编辑资料、好友系统、机器人资料卡
  admin.js                 管理后台：用户管理、封禁、公告、使用统计、建议处理
  ai-bot.js                AI 机器人（思知 API），按触发词回复
  favorites-export.js      收藏管理与数据导出（JSON / HTML）
  wallpaper.js             必应每日一图：应用内背景 + 真实切换系统壁纸
  updater.js / updater.css 自动更新 UI（右下角胶囊 + 浮层卡片）
  app.js                   入口：initApp / initChat
  styles.css               全部样式（含主题变量）
assets/                    icon.ico / icon.png / icon.svg
build.bat                  Windows 一键打包脚本
_build.js                  打包辅助脚本（清理 dist、分别打 portable 与 nsis，历史遗留）
generate-icon.js           SVG → PNG 图标生成
generate-icon-png.js       PNG 多尺寸生成
_makeico.py                PNG → 多尺寸 ICO 生成
LICENSE.txt                许可
```

`main.js` 只有 600 行左右、渲染层是逐个业务文件挂全局函数，**没有模块打包工具**：改完保存，`npm start` 重启即生效，不需要编译步骤。

---

## 3. 进程模型与 IPC

主进程创建窗口时设置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`；页面只能通过 `preload.js` 暴露的 `window.electronAPI` 访问系统能力（外部链接一律 `shell.openExternal`，不在应用内开新窗口）。

| `electronAPI` 方法 | 通道 | 作用 |
|---|---|---|
| `getUserDataPath()` | `get-user-data-path` | 返回 `<用户数据>/data` 目录 |
| `saveLocalData` / `loadLocalData` / `deleteLocalData` | `save-local-data` / `load-local-data` / `delete-local-data` | 读写 `<用户数据>/data/<文件>.json` |
| `exportData({content, format})` | `export-data` | 原生「另存为」对话框后写文件 |
| `showMessageBox(options)` | `show-message-box` | 原生对话框 |
| `minimizeWindow` / `maximizeWindow` / `closeWindow` / `isMaximized` | `minimize-window` / `maximize-window` / `close-window` / `is-maximized` | 窗口控制 |
| `onWindowStateChanged(cb)` | `window-state-changed` | 最大化 / 还原事件 |
| `saveWallpaperTemp(buffer, name)` | `wallpaper-save-temp` | 把壁纸图片落到 `<用户数据>/wallpaper/` |
| `setWallpaper(localPath)` | `wallpaper-set` | 真正切换系统桌面壁纸（Windows 用 PowerShell 调 `SystemParametersInfo`） |
| `onUpdateStatus(cb)` | `update-status` | 订阅更新状态（返回取消订阅函数） |
| `checkForUpdates()` / `installUpdate()` / `getUpdateState()` | `update:check` / `update:install` / `update:get-state` | 手动检查 / 重启安装 / 拉取当前状态 |

落盘位置（Windows 一般是 `%APPDATA%\nflshc-chat\`）：

```
data\*.json       本地缓存数据（由 IPC 读写）
wallpaper\        壁纸图片与 set_wp.ps1
update.log        自动更新日志（排查更新问题先看它）
```

---

## 4. 数据层与认证

渲染层**不直连 GitHub**：所有记录读写都经过 `pages/github-api.js` 里的 `GITHUB_API`（文件名是历史遗留），它指向 `CONFIG.API_BASE`（`https://worker.nflshcchat.cc.cd`）的 **legacy issues 兼容层**——把每条业务记录当成一条「Issue」存进 D1：

```
GET/POST        /api/legacy/issues            列出 / 新建
GET/PATCH       /api/legacy/issues/<number>   读取 / 更新 / 关闭
```

- 记录体格式：`标题` + ` ```json … ``` ` 代码块；`parseJsonFromIssue()` 负责解析，`buildIssueBody()` 负责生成。
- 业务类型由 `labels` 区分：`user`、`chatroom`、`chatmessage`、`favorite`、`friend`、`friend_request`、`system_notification`、`broadcast`、`suggestion`。
- 鉴权：`localStorage['nflshc_token']`（`getToken` / `setToken` / `clearToken`）作为 `Authorization: Bearer` 头；token 由登录接口签发，收到 `401` 视为登录失效。

认证相关接口：

| 接口 | 用途 |
|---|---|
| `POST /api/auth/login` | 登录（前端先做 **SHA-256** 哈希，再传 `password` 字段） |
| `POST /api/auth/logout` | 注销（同时清 token） |
| `GET  /api/auth/me` | 自动登录校验（`checkAutoLogin`） |
| `POST /api/auth/forgot` | 发送找回密码验证码（携带 EmailJS 服务 / 模板 / 公钥，由 Worker 发信） |
| `POST /api/auth/verify-reset` | 校验验证码并换取重置凭据 |

找回密码的验证码走 **EmailJS**（`index.html` 从 jsdelivr 引入 `@emailjs/browser`），`config.js` 里的 `EMAILJS_CONFIG` 是浏览器端公开配置。**注意：** 这组公钥 + service/template 组合可以被别人拿去消耗你的 EmailJS 额度，建议在 EmailJS 后台开启域名白名单并设置限额；私钥（`apiKey`）永远不要写进前端。

`utils.js` 定义了应用级全局状态 `window.NFLSHC`（`currentUser`、`currentRoom`、`allRooms`、`allMessages`、`pollInterval`…）与公共工具（`escapeHtml`、`showToast`、`showModal`、`showPage`、`formatTime`、`calculateLevel`）。等级公式与网页端一致：`level = floor(sqrt(xp / 10)) + 1`。

---

## 5. 自动更新（electron-updater）

实现要点（`main.js` 自动更新区段）：

- **只在打包后的 NSIS 安装版生效**：`app.isPackaged === false`（开发模式）、便携版运行环境、非 Windows 平台都会跳过，并把原因回传界面。
- **便携版为什么不支持**：每次运行都会解压到临时目录执行，找不到可替换的安装位置。主进程用 `PORTABLE_EXECUTABLE_DIR` / `PORTABLE_EXECUTABLE_FILE` / `PORTABLE_EXECUTABLE_APP_FILENAME` 判断，检测到即跳过并提示用户手动下载新版。
- 启动后**延迟 8 秒**自动检查一次；用户也可以点界面上的「检查更新」。
- `autoDownload = true`：发现新版本自动下载；`autoInstallOnAppQuit = true`：正常退出时静默安装。**下载完成后不强制重启**，由用户点「立即重启安装」调用 `quitAndInstall(false, true)`。
- 任何异常都不弹原生报错框、不让主进程挂掉，只写 `update.log` 并回传状态。

状态机（`updateState.state`）与 electron-updater 事件的对应关系：

| state | 触发事件 | 界面文案示例 |
|---|---|---|
| `idle` | 初始化完成 | 自动更新已就绪 |
| `disabled` | 开发模式 / 便携版 / 非 Windows | 便携版不支持自动更新，请下载新版安装包后手动替换 |
| `checking` | `checking-for-update` | 正在检查更新… |
| `available` | `update-available` | 发现新版本 vX.Y.Z，正在自动下载… |
| `downloading` | `download-progress` | 正在下载更新 42% |
| `downloaded` | `update-downloaded` | vX.Y.Z 已下载完成，重启后即可生效 |
| `not-available` | `update-not-available` | 当前已是最新版本 |
| `error` | `error` | 检查更新失败：<原因> |

界面（`pages/updater.js` + `updater.css`）：右下角常驻胶囊 `#updatePill`（显示当前版本，点击展开）、浮层卡片 `#updateCard`（版本、状态、进度条、两个按钮），样式复用 `styles.css` 的主题变量，不引入任何外部资源。

### 发版流程

1. 改 `package.json` 的 `version`（必须与 tag 一致，例如 `2.5.0` ↔ `v2.5.0`）。
2. `build.bat` 打包，产物在 `dist/`。
3. 在**已发布（Published，不能是 Draft）**的 Release 里上传这三个文件（便携版可选）：
   - `NFLSHC-Chat-<版本>-Setup.exe`
   - `NFLSHC-Chat-<版本>-Setup.exe.blockmap`
   - `latest.yml`
4. `latest.yml` 里的 `version` 必须严格大于客户端当前版本，客户端才会提示更新；老客户端只读「最新那个 Release」。

> **文件名三处必须一致**：`latest.yml` 里记录的名字、Release 里实际的文件名、`dist/` 里的产物名。electron-builder 默认产物名带空格（`NFLSHC Chat-2.5.0-Setup.exe`），GitHub 上传时又会把空格换成 `.`，于是三处对不上 → 客户端下载 404。本仓库已在 `package.json` 用连字符的 `artifactName` 一次性解决：
> ```json
> "nsis":     { "artifactName": "NFLSHC-Chat-${version}-Setup.${ext}" },
> "portable": { "artifactName": "NFLSHC-Chat-${version}-Portable.${ext}" }
> ```
> （v2.4.0 及更早的 Release 资产名是 `NFLSHC.Chat-…` 形式，如果官网写死了旧链接需要同步改。）

`package.json` 的 `build.publish` 只声明 `provider/owner/repo`，**不含任何 token**；它的作用是让打包时生成 `resources/app-update.yml`，告诉 electron-updater 去哪里检查更新。日常发版按上面的流程手动上传即可。想在命令行自动上传时用环境变量（不要写进仓库）：

```powershell
$env:GH_TOKEN = "<你的 GitHub Token>"
npx electron-builder --win nsis portable --x64 --publish always
```

---

## 6. 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| 客户端一直显示「已是最新版本」 | `latest.yml` 的 `version` 没大于客户端版本；或打包前忘了改 `package.json` 的 `version` |
| 检查更新失败 / 404 | Release 是 Draft；缺少 `latest.yml`；或文件名对不上（见 §5） |
| 便携版不提示更新 | 设计如此，界面会说明原因 |
| 想看失败细节 | `%APPDATA%\nflshc-chat\update.log` |
| 开发模式没有更新提示 | 设计如此，`app.isPackaged` 为 false 时跳过 |
| 仓库里的图片/图标损坏 | 上传二进制必须走 base64（Contents API）或 git，**不能经过按文本处理的通道**。本仓库的 `assets/icon.ico`、`assets/icon.png` 曾被这样弄坏（PNG 首字节被替换成 U+FFFD、ICO 目录表非法），已在 v2.5.0 的提交里修复；替换图标后请校验文件头（PNG `89 50 4E 47`、ICO `00 00 01 00`） |
| `.gitignore` 里列了 `_build.js` 但仓库里有它 | 该文件在加入 `.gitignore` 之前就已被跟踪，`.gitignore` 对已跟踪文件无效，因此仍会出现在仓库里 |
| 分支不是 `main` | 本仓库默认分支是 **`master`**，别往 `main` 推 |

`.gitignore` 已排除：`node_modules/`、`dist/`、`*.exe`、`*.zip`、`_*.log`、`_*.ps1`、`_debug.js`、`_publish.*`。提交前请确认没有把 token、口令或临时发布脚本带进来。

---

## 7. 图标

```
generate-icon.js        → 从 assets/icon.svg 生成 PNG
generate-icon-png.js    → 生成多种尺寸 PNG
_makeico.py             → 打包成多尺寸 assets/icon.ico（16/32/48/64/128/256）
```

打包使用的图标由 `package.json` 的 `build.win.icon` 指定（`assets/icon.ico`）。替换图标后建议重新打包一次，确认任务栏、安装器与卸载器图标都正常。

---

## 8. 相关仓库

| 仓库 | 说明 |
|---|---|
| [nflshcchat](https://github.com/user-henry/nflshcchat) | 主站前端与统一后端（Cloudflare Worker + D1） |
| [nflshcchat-home](https://github.com/user-henry/nflshcchat-home) | 官网 / 下载页（home.nflshcchat.cc.cd） |
| [chatai](https://github.com/user-henry/chatai) | HZYAI 智能对话助手（chatai.bot.cd） |
| [nflshcchat-platform](https://github.com/user-henry/nflshcchat-platform) | 开发者平台 |
| [nflshcchat-accounts](https://github.com/user-henry/nflshcchat-accounts) | 账号授权中心 |
| [help-nflshc202401](https://github.com/user-henry/help-nflshc202401) | 帮助文档站 |

---

## 9. 许可

见 [LICENSE.txt](LICENSE.txt)。
