// ============================================================
// notifications.js - 通知系统 (系统通知 / @提及通知 / 好友申请通知)
// ============================================================

let notifications = [];
let unreadNotificationCount = 0;

async function loadNotifications() {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('system_notification');
        notifications = [];

        for (const issue of issues) {
            const notifData = parseJsonFromIssue(issue);
            if (notifData && (notifData.targetUser === S.currentUser.username || notifData.targetUser === 'all')) {
                notifications.push({ ...notifData, issueNumber: issue.number });
            }
        }

        notifications.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
        unreadNotificationCount = notifications.filter(n => !n.isRead).length;
        updateNotificationBadge();
    } catch (e) { console.error('加载通知失败:', e); }
}

function updateNotificationBadge() {
    const sidebarActions = document.querySelector('.sidebar-actions');
    let badge = document.getElementById('notifBadge');
    if (!badge && sidebarActions) {
        badge = document.createElement('span');
        badge.id = 'notifBadge';
        badge.className = 'notification-badge';
        const notifBtn = sidebarActions.querySelector('[title="通知"]');
        if (notifBtn) notifBtn.style.position = 'relative';
    }
    if (badge) {
        if (unreadNotificationCount > 0) {
            badge.textContent = unreadNotificationCount > 99 ? '99+' : unreadNotificationCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function showNotifications() {
    let contentHtml;
    if (notifications.length === 0) {
        contentHtml = '<p style="color:var(--text-muted);text-align:center;padding:20px;">暂无通知</p>';
    } else {
        // 标记已读
        notifications.forEach(n => { n.isRead = true; });
        unreadNotificationCount = 0;
        updateNotificationBadge();

        contentHtml = notifications.slice(0, 50).map(n => {
            const iconMap = { mention: '💬', system: '📢', friend: '👥', broadcast: '📣' };
            const icon = iconMap[n.type] || '📌';
            return `
            <div class="notification-item" style="display:flex;align-items:flex-start;gap:10px;padding:10px 6px;border-bottom:1px solid var(--border-light);">
                <span style="font-size:20px;flex-shrink:0;">${icon}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${escapeHtml(n.title)}</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(n.content)}</div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">${formatTime(n.sentAt)}</div>
                </div>
            </div>`;
        }).join('');
    }

    showModal(
        '🔔 通知中心',
        `<div style="max-height:350px;overflow-y:auto;">${contentHtml}</div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>
         ${notifications.length > 0 ? `<button class="fluent-btn accent-btn" onclick="markAllNotificationsRead()">全部已读</button>` : ''}`
    );
}

async function markAllNotificationsRead() {
    notifications.forEach(n => { n.isRead = true; });
    unreadNotificationCount = 0;
    updateNotificationBadge();
    closeModal();
    showToast('已全部标记为已读', 'success');
}

async function sendMentionNotification(mentionedUser, sender, roomName, roomId) {
    const notificationData = {
        id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        type: 'mention',
        title: '有人@了你',
        content: `${sender} 在群聊「${roomName}」中提到了你`,
        targetUser: mentionedUser,
        sender,
        roomId,
        sentAt: new Date().toISOString(),
        isRead: false
    };
    try {
        await GITHUB_API.createIssue(`通知: @${mentionedUser}`, buildIssueBody('系统通知', notificationData), ['system_notification']);
    } catch (e) { console.error('发送通知失败:', e); }
}

// ============ 查看公告 ============
async function showAnnouncements() {
    showModal(
        '📢 系统公告',
        '<div class="loading-text">加载中...</div>',
        '<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>'
    );

    try {
        const { data: issues } = await GITHUB_API.getAllIssues('broadcast');
        const broadcasts = issues.map(i => {
            const bd = parseJsonFromIssue(i);
            return bd ? { ...bd, issueNumber: i.number } : null;
        }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        if (broadcasts.length === 0) {
            document.getElementById('genericModalContent').innerHTML = `
                <h3 class="modal-title">📢 系统公告</h3>
                <p style="color:var(--text-muted);text-align:center;padding:20px;">暂无公告</p>
                <div class="modal-actions"><button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button></div>`;
            return;
        }

        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">📢 系统公告 (${broadcasts.length})</h3>
            <div style="max-height:400px;overflow-y:auto;">
                ${broadcasts.map(b => `
                    <div style="background:var(--bg-tertiary);border-left:3px solid var(--accent-color);border-radius:8px;padding:12px 14px;margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <span style="color:var(--accent-color);font-weight:700;font-size:14px;">${escapeHtml(b.title)}</span>
                            <span style="color:var(--text-muted);font-size:11px;">${formatTime(b.createdAt)}</span>
                        </div>
                        <div style="color:var(--text-primary);font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(b.content)}</div>
                        <div style="color:var(--text-muted);font-size:11px;margin-top:6px;">发布者: ${escapeHtml(b.createdBy || '管理员')}</div>
                    </div>
                `).join('')}
            </div>
            <div class="modal-actions"><button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button></div>`;
    } catch (e) {
        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">📢 系统公告</h3>
            <p style="color:var(--danger);text-align:center;">加载失败: ${e.message}</p>
            <div class="modal-actions"><button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button></div>`;
    }
}

// ============ 通知轮询 ============
let notifPollInterval = null;

function startNotifPolling() {
    if (notifPollInterval) clearInterval(notifPollInterval);
    notifPollInterval = setInterval(async () => {
        if (S.currentUser) await loadNotifications();
    }, 15000); // 每15秒刷新通知
}

function stopNotifPolling() {
    if (notifPollInterval) { clearInterval(notifPollInterval); notifPollInterval = null; }
}

// 在聊天室列表中显示通知指示
function renderRoomsWithNotifications() {
    if (!S.currentRoom || notifications.length === 0) return;
    // 标记哪些聊天室有未读通知
    notifications.filter(n => !n.isRead && n.roomId).forEach(n => {
        const roomEl = document.querySelector(`.room-item[onclick*="${n.roomId}"]`);
        if (roomEl && !roomEl.querySelector('.room-notif-dot')) {
            const dot = document.createElement('span');
            dot.className = 'room-notif-dot';
            dot.textContent = '●';
            dot.style.cssText = 'color:var(--danger);font-size:10px;margin-left:auto;';
            roomEl.appendChild(dot);
        }
    });
}
