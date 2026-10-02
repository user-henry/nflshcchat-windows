/* ============================================================
   NFLSHC Chat - 渲染进程「自动更新」UI 逻辑
   ------------------------------------------------------------
   依赖 preload.js 暴露的 electronAPI：
     electronAPI.onUpdateStatus(cb)  监听主进程转发的更新状态
     electronAPI.checkForUpdates()   手动检查更新
     electronAPI.installUpdate()     重启并安装已下载的更新
     electronAPI.getUpdateState()    主动拉取当前状态（可选）
   对应界面：index.html 中的 #updatePill（右下角胶囊）与 #updateCard（浮动卡片）
   本文件只处理更新提示，不涉及任何既有业务逻辑。
   ============================================================ */
(function () {
    'use strict';

    var api = window.electronAPI;

    // 非 Electron 环境（例如直接用浏览器打开页面）时安全退出，不产生任何报错
    if (!api || typeof api.onUpdateStatus !== 'function' || typeof api.checkForUpdates !== 'function') {
        return;
    }

    // 状态 -> 提示文字配色
    var MESSAGE_CLASS = {
        'idle': 'is-muted',
        'disabled': 'is-muted',
        'checking': 'is-muted',
        'available': 'is-accent',
        'downloading': 'is-accent',
        'downloaded': 'is-success',
        'not-available': 'is-muted',
        'error': 'is-error'
    };

    // 图标字符（Segoe Fluent Icons / Segoe MDL2 Assets）
    var ICON_SYNC = '\uE895';      // 同步
    var ICON_UPDATE = '\uE777';    // 更新还原

    var pill = null;
    var pillIcon = null;
    var pillText = null;
    var card = null;
    var closeBtn = null;
    var versionEl = null;
    var messageEl = null;
    var noteEl = null;
    var progressWrap = null;
    var progressFill = null;
    var progressText = null;
    var checkBtn = null;
    var checkBtnText = null;
    var installBtn = null;

    var prevState = null;

    // 轻提示（复用 index.html 中的全局 toast，不存在时静默忽略）
    function safeToast(message) {
        try {
            if (typeof window.toast === 'function') window.toast(message);
        } catch (e) { /* 忽略提示失败 */ }
    }

    // 是否处于"忙碌"状态（检查中 / 下载中），此时禁用"检查更新"按钮
    function isBusy(state) {
        return state === 'checking' || state === 'downloading';
    }

    // ==== 展开 / 收起 ====
    function openCard() {
        if (!card) return;
        card.classList.add('show');
        if (pill) pill.classList.remove('show');
    }

    function collapseCard() {
        if (card) card.classList.remove('show');
        if (pill) pill.classList.add('show');
    }

    function toggleCard() {
        if (!card) return;
        if (card.classList.contains('show')) {
            collapseCard();
        } else {
            openCard();
        }
    }

    // ==== 渲染状态 ====
    function render(status) {
        if (!status || typeof status !== 'object') return;

        var state = status.state || 'idle';
        var changed = (prevState !== state);
        prevState = state;

        // 当前版本号
        if (versionEl && status.currentVersion) {
            versionEl.textContent = 'v' + status.currentVersion;
        }

        // 提示文字
        if (messageEl) {
            messageEl.textContent = status.message || '暂无更新信息';
            messageEl.className = 'update-message ' + (MESSAGE_CLASS[state] || 'is-muted');
        }

        // 不可用原因（开发模式 / 便携版等）
        if (noteEl) {
            if (state === 'disabled' && status.message) {
                noteEl.textContent = status.reason === 'portable'
                    ? '提示：便携版每次运行都会解压到临时目录，无法自动替换自身文件，因此不支持自动更新。'
                    : '提示：' + status.message;
                noteEl.classList.add('show');
            } else {
                noteEl.textContent = '';
                noteEl.classList.remove('show');
            }
        }

        // 下载进度条
        var showProgress = (state === 'available' || state === 'downloading');
        var percent = Math.max(0, Math.min(100, Math.round(status.percent || 0)));
        if (progressWrap) {
            if (showProgress) {
                progressWrap.classList.add('show');
            } else {
                progressWrap.classList.remove('show');
            }
        }
        if (progressFill) progressFill.style.width = percent + '%';
        if (progressText) progressText.textContent = percent + '%';

        // 操作按钮
        if (installBtn) {
            if (state === 'downloaded') {
                installBtn.classList.add('show');
                installBtn.disabled = false;
            } else {
                installBtn.classList.remove('show');
            }
        }
        if (checkBtn) {
            var unavailable = (state === 'disabled');
            checkBtn.disabled = unavailable || isBusy(state);
        }
        if (checkBtnText) {
            checkBtnText.textContent = (state === 'checking') ? '检查中…' : '检查更新';
        }

        // 胶囊文案
        if (pillText) {
            var current = status.currentVersion ? ('v' + status.currentVersion) : '检查更新';
            if (state === 'downloaded') {
                pillText.textContent = '待安装 ' + (status.version ? ('v' + status.version) : '更新');
            } else if (state === 'available' || state === 'downloading') {
                pillText.textContent = '可更新 ' + (status.version ? ('v' + status.version) : '');
            } else {
                pillText.textContent = current;
            }
        }
        if (pillIcon) pillIcon.textContent = ICON_SYNC;

        // 胶囊高亮：有新版本 / 待安装
        if (pill) {
            var hasNew = (state === 'available' || state === 'downloading' || state === 'downloaded');
            if (hasNew) {
                pill.classList.add('has-update');
            } else {
                pill.classList.remove('has-update');
            }
        }

        // 有新版本时自动展开卡片，其余情况保持用户当前选择
        if (state === 'available' || state === 'downloading' || state === 'downloaded') {
            openCard();
        }

        // 卡片收起时保证右下角胶囊入口始终可见
        if (card && !card.classList.contains('show')) {
            if (pill) pill.classList.add('show');
        }

        // 仅在状态发生变化时弹轻提示，避免下载进度刷屏
        if (changed) {
            if (state === 'available') {
                safeToast('发现新版本，正在后台下载…');
            } else if (state === 'downloaded') {
                safeToast('更新已下载完成，可重启安装');
            } else if (state === 'not-available') {
                safeToast('当前已是最新版本');
            } else if (state === 'error') {
                safeToast('检查更新失败，详见更新卡片');
            }
        }
    }

    // ==== 手动检查更新 ====
    function onCheckClick() {
        if (checkBtn) checkBtn.disabled = true;
        if (checkBtnText) checkBtnText.textContent = '检查中…';
        if (messageEl) {
            messageEl.textContent = '正在检查更新…';
            messageEl.className = 'update-message is-muted';
        }
        openCard();

        var result;
        try {
            result = api.checkForUpdates();
        } catch (e) {
            render({ state: 'error', message: '检查更新失败：' + (e && e.message ? e.message : '未知错误') });
            return;
        }
        // 无论成功失败都恢复按钮状态，错误已由主进程负责转发
        if (result && typeof result.then === 'function') {
            result.then(function (status) {
                if (status) render(status);
                else if (checkBtn) checkBtn.disabled = false;
            }).catch(function () {
                if (checkBtn) checkBtn.disabled = false;
                if (checkBtnText) checkBtnText.textContent = '检查更新';
            });
        } else if (checkBtn) {
            checkBtn.disabled = false;
        }
    }

    // ==== 立即重启并安装（用户主动确认） ====
    function onInstallClick() {
        if (installBtn) {
            installBtn.disabled = true;
            var label = installBtn.querySelector('span:last-child');
            if (label) label.textContent = '正在重启…';
        }
        try {
            var result = api.installUpdate();
            if (result && typeof result.then === 'function') {
                result.then(function (res) {
                    // 安装成功后应用会立即退出，这里只处理失败的情况
                    if (res && res.ok === false) {
                        safeToast(res.message || '安装更新失败');
                        if (installBtn) {
                            installBtn.disabled = false;
                            var l = installBtn.querySelector('span:last-child');
                            if (l) l.textContent = '立即重启安装';
                        }
                    }
                }).catch(function () { /* 应用退出时请求可能被中断，属正常 */ });
            }
        } catch (e) {
            safeToast('安装更新失败：' + (e && e.message ? e.message : '未知错误'));
            if (installBtn) installBtn.disabled = false;
        }
    }

    // ==== 初始化 ====
    function init() {
        pill = document.getElementById('updatePill');
        pillIcon = document.getElementById('updatePillIcon');
        pillText = document.getElementById('updatePillText');
        card = document.getElementById('updateCard');
        closeBtn = document.getElementById('updateCardClose');
        versionEl = document.getElementById('updateCurrentVersion');
        messageEl = document.getElementById('updateMessage');
        noteEl = document.getElementById('updateNote');
        progressWrap = document.getElementById('updateProgressWrap');
        progressFill = document.getElementById('updateProgressFill');
        progressText = document.getElementById('updateProgressText');
        checkBtn = document.getElementById('updateCheckBtn');
        checkBtnText = document.getElementById('updateCheckBtnText');
        installBtn = document.getElementById('updateInstallBtn');

        // 更新 UI 不存在时（例如被裁剪的页面）直接退出
        if (!pill || !card) return;

        if (checkBtn) checkBtn.addEventListener('click', onCheckClick);
        if (installBtn) installBtn.addEventListener('click', onInstallClick);
        if (closeBtn) closeBtn.addEventListener('click', collapseCard);
        pill.addEventListener('click', toggleCard);

        // 先注册监听，再主动拉取一次状态：两者结合可避免漏掉启动早期的更新事件
        api.onUpdateStatus(render);

        // 默认展示右下角胶囊入口，保证"检查更新"随时可用
        pill.classList.add('show');

        if (typeof api.getUpdateState === 'function') {
            try {
                var p = api.getUpdateState();
                if (p && typeof p.then === 'function') {
                    p.then(function (status) { if (status) render(status); })
                        .catch(function () { render({ state: 'idle', message: '自动更新已就绪' }); });
                }
            } catch (e) {
                render({ state: 'idle', message: '自动更新已就绪' });
            }
        } else {
            render({ state: 'idle', message: '自动更新已就绪' });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
