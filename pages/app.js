// ============================================================
// app.js - NFLSHC Chat Windows 入口文件
// 所有功能模块已在各分文件中实现，本文件仅负责初始化
// ============================================================

// ============ 聊天初始化 ============
async function initChat() {
    // 更新侧边栏用户信息
    document.getElementById('sidebarUsername').textContent = S.currentUser.username;
    const profile = await loadUserProfile();
    const avatarUrl = (profile && profile.avatarUrl) ? profile.avatarUrl : SITE_LOGO;
    S.userAvatarCache[S.currentUser.username] = avatarUrl;
    document.getElementById('sidebarAvatar').style.backgroundImage = `url('${avatarUrl}')`;

    await loadRooms();
    loadGlobalMsgCounts();
    setupScrollDetection();
    loadNotifications();
    startNotifPolling();  // 每15秒刷新通知

    // 消息输入事件
    const input = document.getElementById('messageInput');
    if (input) {
        input.addEventListener('input', updateMarkdownPreview);
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // 聊天室搜索
    document.getElementById('roomSearch').addEventListener('input', filterRooms);

    // 关闭忘记密码弹窗（点击遮罩）
    document.getElementById('forgotModal').addEventListener('click', function (e) {
        if (e.target === this) closeForgotModal();
    });

    // 登录页回车
    const loginPassEl = document.getElementById('loginPassword');
    if (loginPassEl) {
        loginPassEl.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') login();
        });
    }

    console.log('NFLSHC Chat Windows 已初始化');

    // 初始化必应每日一图壁纸
    initWallpaper();
}

// ============ 窗口控制 ============
document.addEventListener('DOMContentLoaded', () => {
    // 标题栏按钮
    const btnMin = document.getElementById('btnMinimize');
    const btnMax = document.getElementById('btnMaximize');
    const btnClose = document.getElementById('btnClose');

    if (btnMin) btnMin.addEventListener('click', () => {
        if (window.electronAPI?.minimizeWindow) window.electronAPI.minimizeWindow();
    });
    if (btnMax) btnMax.addEventListener('click', () => {
        if (window.electronAPI?.maximizeWindow) window.electronAPI.maximizeWindow();
    });
    if (btnClose) btnClose.addEventListener('click', () => {
        if (window.electronAPI?.closeWindow) window.electronAPI.closeWindow();
    });

    // 监听窗口状态变化
    if (window.electronAPI?.onWindowStateChanged) {
        window.electronAPI.onWindowStateChanged((state) => {
            if (btnMax) btnMax.innerHTML = state === 'maximized' ? '&#xE923;' : '&#xE922;';
        });
    }

    // 初始化
    initApp();
});

async function initApp() {
    // 先尝试自动登录
    const autoLoggedIn = await checkAutoLogin();
    if (!autoLoggedIn) {
        showLoginPage();
    }

    // 注册页回车
    const regPwdConfirm = document.getElementById('regPasswordConfirm');
    if (regPwdConfirm) {
        regPwdConfirm.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') register();
        });
    }
}
