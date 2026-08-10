// NFLSHC Chat - Electron 主进程
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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
