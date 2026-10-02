// NFLSHC Chat - Electron 主进程
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

// electron-updater 实例（懒加载：开发环境未安装该模块时也不会导致主进程启动失败）
let autoUpdater = null;
let updaterInitialized = false;

// 启动后延迟多久自动检查一次更新（毫秒），避免与登录 / 壁纸等启动流程抢占资源
const UPDATE_AUTO_CHECK_DELAY = 8000;

// 数据存储目录（用户数据目录）
const userDataPath = app.getPath('userData');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'NFLSHC Chat',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        backgroundColor: '#1a1a2e',
        titleBarStyle: 'default',
        frame: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    // Windows 原生菜单
    mainWindow.setMenuBarVisibility(false);

    mainWindow.loadFile(path.join(__dirname, 'pages', 'index.html'));

    // 页面加载完成后补发一次更新状态，避免更新事件早于渲染进程监听注册而丢失
    mainWindow.webContents.on('did-finish-load', () => {
        broadcastUpdateStatus();
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 外部链接用默认浏览器打开
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    // 确保数据目录存在
    const dataDir = path.join(userDataPath, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    createWindow();

    // 启动后延迟自动检查一次更新（仅打包后生效）
    scheduleAutoUpdateCheck();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC: 获取应用数据路径
ipcMain.handle('get-user-data-path', () => {
    return path.join(userDataPath, 'data');
});

// IPC: 保存本地数据
ipcMain.handle('save-local-data', async (event, filename, data) => {
    try {
        const dataDir = path.join(userDataPath, 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const filePath = path.join(dataDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC: 读取本地数据
ipcMain.handle('load-local-data', async (event, filename) => {
    try {
        const filePath = path.join(userDataPath, 'data', filename);
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf-8');
            return { success: true, data: JSON.parse(data) };
        }
        return { success: true, data: null };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC: 删除本地数据
ipcMain.handle('delete-local-data', async (event, filename) => {
    try {
        const filePath = path.join(userDataPath, 'data', filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC: 导出数据
ipcMain.handle('export-data', async (event, options) => {
    try {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: '导出聊天数据',
            defaultPath: `nflshc-chat-export-${Date.now()}.${options.format || 'json'}`,
            filters: [
                { name: 'JSON 文件', extensions: ['json'] },
                { name: 'HTML 文件', extensions: ['html'] },
                { name: '所有文件', extensions: ['*'] }
            ]
        });
        if (!result.canceled && result.filePath) {
            fs.writeFileSync(result.filePath, options.content, 'utf-8');
            return { success: true, filePath: result.filePath };
        }
        return { success: false, canceled: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// IPC: 显示原生对话框
ipcMain.handle('show-message-box', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, options);
    return result;
});

// IPC: 窗口控制
ipcMain.on('minimize-window', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('close-window', () => {
    if (mainWindow) mainWindow.close();
});

// IPC: 获取窗口状态
ipcMain.handle('is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
});

// ============ 壁纸：保存临时图片 ============
ipcMain.handle('wallpaper-save-temp', async (event, buffer, fileName) => {
    try {
        const dir = path.join(userDataPath, 'wallpaper');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return filePath;
    } catch (error) {
        console.error('保存壁纸临时文件失败:', error);
        throw error;
    }
});

// ============ 壁纸：真实切换系统桌面壁纸 ============
ipcMain.handle('wallpaper-set', async (event, localPath) => {
    try {
        if (!fs.existsSync(localPath)) return false;
        if (process.platform === 'win32') {
            const { execFileSync } = require('child_process');
            // 将 PowerShell 脚本写入临时文件执行，避免 -Command 中 here-string 解析问题
            const psPath = path.join(userDataPath, 'wallpaper', 'set_wp.ps1');
            const psDir = path.dirname(psPath);
            if (!fs.existsSync(psDir)) fs.mkdirSync(psDir, { recursive: true });
            const escaped = localPath.replace(/'/g, "''");
            const ps = [
                '$ErrorActionPreference = "Stop"',
                `$path = '${escaped}'`,
                'Add-Type @\'',
                '[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]',
                'public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);',
                '\'@',
                '[void][SystemParametersInfo]::SystemParametersInfo(20, 0, $path, 3)',
                ''
            ].join('\r\n');
            fs.writeFileSync(psPath, ps, 'utf8');
            execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], { windowsHide: true });
            return true;
        } else if (process.platform === 'darwin') {
            const { execFileSync } = require('child_process');
            execFileSync('osascript', ['-e', `tell application "System Events" to set picture of every desktop to "${localPath}"`]);
            return true;
        }
        return false;
    } catch (error) {
        console.error('切换系统桌面壁纸失败:', error);
        return false;
    }
});

// 监听最大化/还原事件
app.on('browser-window-created', (event, win) => {
    win.on('maximize', () => {
        win.webContents.send('window-state-changed', 'maximized');
    });
    win.on('unmaximize', () => {
        win.webContents.send('window-state-changed', 'normal');
    });
});

/* ============================================================
   自动更新（electron-updater + GitHub Releases）
   ------------------------------------------------------------
   设计要点：
   1. 仅打包后（app.isPackaged）生效，开发模式直接跳过，避免报错
   2. 便携版（portable）不支持自动更新，检测到即跳过并说明原因
   3. 所有事件统一转成 'update-status' 消息转发到渲染进程（含 mainWindow 为空时的防御）
   4. 发现新版本自动下载；下载完成后不强制重启，由用户点击"立即重启安装"确认
   5. 任何异常只写日志 + 通知渲染进程，不弹原生报错框、不使主进程崩溃
   ============================================================ */

// 更新日志文件：用户数据目录下的 update.log（Windows 通常为 %APPDATA%\<应用名>\update.log）
const updateLogPath = path.join(userDataPath, 'update.log');

// 更新相关统一日志（写文件 + 控制台，写入失败也不影响主流程）
function updaterLog(...args) {
    const text = args
        .map((item) => {
            if (item instanceof Error) return item.stack || item.message;
            if (typeof item === 'object' && item !== null) {
                try { return JSON.stringify(item); } catch (e) { return String(item); }
            }
            return String(item);
        })
        .join(' ');
    const line = `[${new Date().toISOString()}] ${text}`;
    try {
        console.log('[updater]', text);
    } catch (e) { /* 忽略 */ }
    try {
        fs.appendFileSync(updateLogPath, line + '\r\n', 'utf-8');
    } catch (e) { /* 忽略日志写入错误 */ }
}

// 当前更新状态（缓存最后状态，供渲染进程加载后主动拉取）
const updateState = {
    state: 'idle',          // idle | disabled | checking | available | downloading | downloaded | not-available | error
    message: '尚未检查更新',
    currentVersion: null,   // 当前应用版本号
    version: null,          // 新版本号（如有）
    percent: 0,             // 下载进度百分比
    transferred: 0,         // 已下载字节数
    total: 0,               // 总字节数
    bytesPerSecond: 0,      // 下载速度
    releaseDate: null,      // 新版本发布时间
    releaseNotes: null,     // 新版本更新说明
    reason: null,           // 不可用原因：dev / portable / platform / load-failed
    error: null             // 错误信息
};

// 安全获取当前版本号
function getCurrentVersion() {
    try {
        return app.getVersion();
    } catch (e) {
        return '0.0.0';
    }
}

// 是否以"便携版（portable）"方式运行：electron-builder 的 portable target 会注入这些环境变量
function isPortableRuntime() {
    return !!(process.env.PORTABLE_EXECUTABLE_DIR ||
        process.env.PORTABLE_EXECUTABLE_FILE ||
        process.env.PORTABLE_EXECUTABLE_APP_FILENAME);
}

// 判断当前环境是否支持自动更新
function getUpdaterAvailability() {
    if (!app.isPackaged) {
        return { ok: false, reason: 'dev', message: '开发模式下不检查更新' };
    }
    if (isPortableRuntime()) {
        return { ok: false, reason: 'portable', message: '便携版不支持自动更新，请下载新版安装包后手动替换' };
    }
    if (process.platform !== 'win32') {
        return { ok: false, reason: 'platform', message: '当前平台暂未提供自动更新包' };
    }
    return { ok: true, reason: null, message: '' };
}

// 把最新状态发到渲染进程（mainWindow 可能为 null / 已销毁 / 页面还在加载，全部做防御）
function broadcastUpdateStatus() {
    updateState.currentVersion = getCurrentVersion();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const contents = mainWindow.webContents;
    if (!contents || contents.isDestroyed()) return;
    try {
        contents.send('update-status', Object.assign({}, updateState));
    } catch (e) {
        updaterLog('转发更新状态到渲染进程失败:', e);
    }
}

// 合并状态补丁 -> 缓存 -> 转发，并返回合并后的状态副本
function sendUpdateStatus(patch) {
    if (patch && typeof patch === 'object') {
        Object.assign(updateState, patch);
    }
    broadcastUpdateStatus();
    return Object.assign({}, updateState);
}

// 更新说明可能是字符串或 {版本: 说明} 形式，统一转成字符串
function normalizeReleaseNotes(info) {
    if (!info) return null;
    const notes = info.releaseNotes;
    if (!notes) return null;
    if (typeof notes === 'string') return notes;
    if (Array.isArray(notes)) {
        return notes
            .map((item) => (item && item.note) ? `${item.version || ''}\n${item.note}` : '')
            .filter(Boolean)
            .join('\n\n') || null;
    }
    return null;
}

// 初始化 electron-updater 并注册全部事件
function initAutoUpdater() {
    if (updaterInitialized) return true;

    const availability = getUpdaterAvailability();
    if (!availability.ok) {
        updaterLog('自动更新已跳过：' + availability.message);
        sendUpdateStatus({
            state: 'disabled',
            reason: availability.reason,
            message: availability.message,
            percent: 0
        });
        return false;
    }

    try {
        // 懒加载：即使依赖缺失也只是更新功能不可用，不影响应用启动
        autoUpdater = require('electron-updater').autoUpdater;
    } catch (e) {
        updaterLog('加载 electron-updater 失败:', e);
        sendUpdateStatus({
            state: 'error',
            reason: 'load-failed',
            message: '自动更新组件加载失败：' + (e && e.message ? e.message : '未知错误'),
            error: (e && e.message) || String(e)
        });
        return false;
    }

    // 发现新版本自动开始下载
    autoUpdater.autoDownload = true;
    // 用户正常退出时静默安装已下载的更新（不强制重启、不打断当前使用）
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;

    // 日志重定向到 update.log（不使用原生弹窗）
    autoUpdater.logger = {
        info: (msg) => updaterLog('[info]', msg),
        warn: (msg) => updaterLog('[warn]', msg),
        error: (msg) => updaterLog('[error]', msg),
        debug: () => { /* 忽略调试日志 */ }
    };

    // ---------- 事件：开始检查 ----------
    autoUpdater.on('checking-for-update', () => {
        updaterLog('开始检查更新');
        sendUpdateStatus({
            state: 'checking',
            message: '正在检查更新…',
            percent: 0,
            error: null,
            reason: null
        });
    });

    // ---------- 事件：发现新版本（automatic download 会紧接着开始下载） ----------
    autoUpdater.on('update-available', (info) => {
        const version = (info && info.version) || null;
        updaterLog('发现新版本:', version);
        sendUpdateStatus({
            state: 'available',
            message: version ? `发现新版本 v${version}，正在自动下载…` : '发现新版本，正在自动下载…',
            version: version,
            releaseDate: (info && info.releaseDate) || null,
            releaseNotes: normalizeReleaseNotes(info),
            percent: 0,
            error: null
        });
    });

    // ---------- 事件：已是最新版本 ----------
    autoUpdater.on('update-not-available', (info) => {
        updaterLog('当前已是最新版本');
        sendUpdateStatus({
            state: 'not-available',
            message: '当前已是最新版本',
            version: (info && info.version) || null,
            percent: 0,
            error: null
        });
    });

    // ---------- 事件：下载进度 ----------
    autoUpdater.on('download-progress', (progress) => {
        const rawPercent = (progress && typeof progress.percent === 'number') ? progress.percent : 0;
        const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));
        sendUpdateStatus({
            state: 'downloading',
            message: `正在下载更新 ${percent}%`,
            percent: percent,
            transferred: (progress && progress.transferred) || 0,
            total: (progress && progress.total) || 0,
            bytesPerSecond: (progress && progress.bytesPerSecond) || 0,
            error: null
        });
    });

    // ---------- 事件：下载完成（不自动重启，等用户确认） ----------
    autoUpdater.on('update-downloaded', (info) => {
        const version = (info && info.version) || updateState.version;
        updaterLog('更新已下载完成:', version);
        sendUpdateStatus({
            state: 'downloaded',
            message: version ? `v${version} 已下载完成，重启后即可生效` : '更新已下载完成，重启后即可生效',
            version: version,
            percent: 100,
            error: null
        });
    });

    // ---------- 事件：发生错误（只记录日志 + 通知渲染进程） ----------
    autoUpdater.on('error', (err) => {
        updaterLog('自动更新出错:', err);
        sendUpdateStatus({
            state: 'error',
            message: '检查更新失败：' + ((err && err.message) ? err.message : '未知错误'),
            error: (err && err.message) || String(err),
            percent: 0
        });
    });

    updaterInitialized = true;
    updaterLog('自动更新初始化完成');
    sendUpdateStatus({
        state: 'idle',
        message: '自动更新已就绪',
        reason: null,
        error: null,
        percent: 0
    });
    return true;
}

// 执行一次检查（内部/启动自动检查与手动检查共用）
async function checkForUpdatesNow(trigger) {
    const availability = getUpdaterAvailability();
    if (!availability.ok) {
        updaterLog('跳过检查更新(' + (trigger || 'unknown') + ')：' + availability.message);
        return sendUpdateStatus({
            state: 'disabled',
            reason: availability.reason,
            message: availability.message,
            percent: 0
        });
    }

    if (!initAutoUpdater()) {
        return Object.assign({}, updateState);
    }

    try {
        updaterLog('触发检查更新，来源：' + (trigger || 'unknown'));
        await autoUpdater.checkForUpdates();
    } catch (e) {
        // 已在更新中等情况也会走到这里，统一降级为状态提示，绝不抛出
        updaterLog('检查更新失败:', e);
        sendUpdateStatus({
            state: 'error',
            message: '检查更新失败：' + ((e && e.message) ? e.message : '未知错误'),
            error: (e && e.message) || String(e)
        });
    }
    return Object.assign({}, updateState);
}

// 启动后延迟自动检查一次
function scheduleAutoUpdateCheck() {
    const availability = getUpdaterAvailability();
    if (!availability.ok) {
        updaterLog('本次启动不启用自动更新：' + availability.message);
        sendUpdateStatus({
            state: 'disabled',
            reason: availability.reason,
            message: availability.message,
            percent: 0
        });
        return;
    }

    setTimeout(() => {
        checkForUpdatesNow('startup');
    }, UPDATE_AUTO_CHECK_DELAY);
}

// IPC: 手动检查更新
ipcMain.handle('update:check', async () => {
    try {
        return await checkForUpdatesNow('manual');
    } catch (e) {
        updaterLog('手动检查更新异常:', e);
        return sendUpdateStatus({
            state: 'error',
            message: '检查更新失败：' + ((e && e.message) ? e.message : '未知错误'),
            error: (e && e.message) || String(e)
        });
    }
});

// IPC: 立即重启并安装已下载的更新（由用户点击确认后调用）
ipcMain.handle('update:install', async () => {
    const availability = getUpdaterAvailability();
    if (!availability.ok) {
        return Object.assign({ ok: false }, updateState, { message: availability.message });
    }
    if (!autoUpdater || updateState.state !== 'downloaded') {
        return Object.assign({ ok: false }, updateState, { message: '更新尚未下载完成，请稍后再试' });
    }
    try {
        updaterLog('用户确认安装更新，准备退出并安装');
        // 稍作延迟，保证 IPC 结果能先返回给渲染进程
        setTimeout(() => {
            try {
                autoUpdater.quitAndInstall(false, true);
            } catch (e) {
                updaterLog('quitAndInstall 调用失败:', e);
                sendUpdateStatus({
                    state: 'error',
                    message: '安装更新失败：' + ((e && e.message) ? e.message : '未知错误'),
                    error: (e && e.message) || String(e)
                });
            }
        }, 300);
        return Object.assign({ ok: true }, updateState);
    } catch (e) {
        updaterLog('安装更新异常:', e);
        return Object.assign({ ok: false }, updateState, {
            message: '安装更新失败：' + ((e && e.message) ? e.message : '未知错误'),
            error: (e && e.message) || String(e)
        });
    }
});

// IPC: 渲染进程加载后主动拉取一次当前更新状态
ipcMain.handle('update:get-state', () => {
    updateState.currentVersion = getCurrentVersion();
    return Object.assign({}, updateState);
});
