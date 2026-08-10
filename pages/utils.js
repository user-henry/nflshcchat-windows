// ============================================================
// utils.js - NFLSHC Chat Windows 全局状态 & 工具函数
// ============================================================

// ============ 全局状态 ============
window.NFLSHC = window.NFLSHC || {};
const S = window.NFLSHC;

S.currentUser = null;
S.currentRoom = null;
S.allRooms = [];
S.allMessages = [];
S.pollInterval = null;
S.replyToMessage = null;
S.globalMsgCounts = {};
S.userAvatarCache = {};
S.currentPage = 1;
S.hasMoreMessages = true;
S.isLoadingMore = false;
S.newestMessageTimestamp = null;
S.isUserScrolling = false;
S.scrollTimeout = null;

// ============ 配置引用 ============
const CONFIG = window.CONFIG;
const BOT_CONFIG = window.BOT_CONFIG;
const SITE_LOGO = window.SITE_LOGO || '../assets/icon.png';

// ============ 工具函数 ============
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function generateRandomCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function isSystemAdmin(username) {
    return username === 'huangzhiyuan';
}

function calculateLevel(xp) {
    xp = xp || 0;
    return Math.floor(Math.sqrt(xp / 10)) + 1;
}

function getLevelClass(level) {
    if (level <= 3) return 'level-low';
    if (level <= 6) return 'level-mid';
    if (level <= 9) return 'level-high';
    return 'level-top';
}

function formatTime(isoString) {
    const d = new Date(isoString);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    return d.toLocaleString('zh-CN');
}

// ============ Toast 通知 ============
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============ 模态框管理 ============
function showModal(title, contentHtml, actionsHtml) {
    const modal = document.getElementById('genericModal');
    const content = document.getElementById('genericModalContent');
    content.innerHTML = `
        <h3 class="modal-title">${title}</h3>
        ${contentHtml}
        ${actionsHtml ? `<div class="modal-actions">${actionsHtml}</div>` : ''}
    `;
    modal.classList.add('show');
}

function closeModal() {
    document.getElementById('genericModal').classList.remove('show');
}

// 点击遮罩关闭
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('genericModal').addEventListener('click', function(e) {
        if (e.target === this) closeModal();
    });
});

// ============ 页面切换 ============
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
}

function showLoginPage() {
    showPage('loginPage');
    const el = document.getElementById('loginUsername');
    if (el) el.focus();
}

function showRegisterPage() {
    showPage('registerPage');
    const el = document.getElementById('regUsername');
    if (el) el.focus();
}

function showChatPage() {
    showPage('chatPage');
}
