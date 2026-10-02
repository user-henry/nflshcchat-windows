// NFLSHC Chat - Preload 脚本
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 本地数据存储
    saveLocalData: (filename, data) => ipcRenderer.invoke('save-local-data', filename, data),
    loadLocalData: (filename) => ipcRenderer.invoke('load-local-data', filename),
    deleteLocalData: (filename) => ipcRenderer.invoke('delete-local-data', filename),
    getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

    // 导出数据
    exportData: (options) => ipcRenderer.invoke('export-data', options),

    // 原生对话框
    showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

    // 窗口控制
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    maximizeWindow: () => ipcRenderer.send('maximize-window'),
    closeWindow: () => ipcRenderer.send('close-window'),
    isMaximized: () => ipcRenderer.invoke('is-maximized'),

    // 窗口状态变化
    onWindowStateChanged: (callback) => {
        ipcRenderer.on('window-state-changed', (event, state) => callback(state));
    },

    // 平台信息
    platform: process.platform,
    isElectron: true,

    // 壁纸：保存临时图片文件，返回本地路径
    saveWallpaperTemp: (buffer, fileName) => ipcRenderer.invoke('wallpaper-save-temp', buffer, fileName),
    // 壁纸：真实切换系统桌面壁纸，返回是否成功
    setWallpaper: (localPath) => ipcRenderer.invoke('wallpaper-set', localPath),

    // ============ 自动更新 ============
    // 监听主进程转发的更新状态；callback 收到 { state, message, version, percent, ... }
    // 返回取消监听函数，便于页面卸载时清理
    onUpdateStatus: (callback) => {
        const listener = (event, status) => {
            if (typeof callback === 'function') callback(status);
        };
        ipcRenderer.on('update-status', listener);
        return () => ipcRenderer.removeListener('update-status', listener);
    },
    // 手动检查更新，返回检查后的状态对象
    checkForUpdates: () => ipcRenderer.invoke('update:check'),
    // 重启并安装已下载的更新（下载完成后由用户确认调用）
    installUpdate: () => ipcRenderer.invoke('update:install'),
    // 主动拉取当前更新状态（页面加载后立即渲染用）
    getUpdateState: () => ipcRenderer.invoke('update:get-state')
});
