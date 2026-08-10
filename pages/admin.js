// ============================================================
// admin.js - 管理后台 (用户管理 / 封禁 / 公告 / 统计)
// ============================================================

function showAdminPanel() {
    if (!isSystemAdmin(S.currentUser?.username) && !S.currentUser?.isAdmin) {
        showToast('没有管理员权限', 'error');
        return;
    }
    showModal(
        '🔧 管理后台',
        `<div class="loading-text">加载中...</div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>`
    );
    loadAdminDashboard();
}

async function loadAdminDashboard() {
    try {
        const { data: users } = await GITHUB_API.getAllIssues('user');
        const { data: rooms } = await GITHUB_API.getAllIssues('chatroom');
        let messageCount = 0;
        const { data: messages } = await GITHUB_API.getIssues('chatmessage', { per_page: 10 });
        messageCount = messages.length;

        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">🔧 管理后台</h3>
            <div class="admin-stats">
                <div class="stat-card"><div class="stat-num">${users.length}</div><div class="stat-label">用户数</div></div>
                <div class="stat-card"><div class="stat-num">${rooms.length}</div><div class="stat-label">聊天室</div></div>
                <div class="stat-card"><div class="stat-num">${messageCount}+</div><div class="stat-label">消息(最近)</div></div>
            </div>
            <div class="admin-tabs" style="display:flex;gap:4px;margin-top:16px;">
                <button class="admin-tab active" onclick="showAdminTab('users')" style="flex:1;padding:8px;background:var(--accent-color);color:var(--text-inverse);border:none;border-radius:8px;cursor:pointer;font-weight:600;">用户管理</button>
                <button class="admin-tab" onclick="showAdminTab('broadcast')" style="flex:1;padding:8px;background:var(--bg-tertiary);color:var(--text-primary);border:none;border-radius:8px;cursor:pointer;">发布公告</button>
                <button class="admin-tab" onclick="showAdminTab('suggestions')" style="flex:1;padding:8px;background:var(--bg-tertiary);color:var(--text-primary);border:none;border-radius:8px;cursor:pointer;">意见反馈</button>
            </div>
            <div id="adminTabContent"></div>
            <div class="modal-actions">
                <button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>
            </div>`;
        showAdminTab('users');
    } catch (e) {
        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">🔧 管理后台</h3>
            <p style="color:var(--danger);">加载失败: ${e.message}</p>
            <div class="modal-actions"><button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button></div>`;
    }
}

function switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-tab').forEach(t => {
        t.style.background = 'var(--bg-tertiary)';
        t.style.color = 'var(--text-primary)';
    });
    const activeBtn = document.querySelector(`.admin-tab:nth-child(${tabName === 'users' ? '1' : tabName === 'broadcast' ? '2' : '3'})`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.background = 'var(--accent-color)';
        activeBtn.style.color = 'var(--text-inverse)';
    }
}

async function showAdminTab(tabName) {
    switchAdminTab(tabName);
    const tabContent = document.getElementById('adminTabContent');

    if (tabName === 'users') {
        tabContent.innerHTML = '<div class="loading-text">加载用户列表...</div>';
        await loadAdminUsers(tabContent);
    } else if (tabName === 'broadcast') {
        tabContent.innerHTML = `
            <div class="input-group" style="margin-top:12px;">
                <input type="text" id="broadcastTitle" placeholder="公告标题" class="fluent-input" style="padding-left:12px;">
            </div>
            <div class="input-group" style="margin-top:8px;">
                <textarea id="broadcastContent" rows="4" placeholder="公告内容" class="fluent-input" style="padding-left:12px;resize:vertical;"></textarea>
            </div>
            <button class="fluent-btn accent-btn" onclick="sendBroadcast()" style="width:100%;margin-top:8px;">📣 发布公告</button>
            <div id="broadcastMsg" class="message-text" style="margin-top:8px;"></div>`;
    } else if (tabName === 'suggestions') {
        await loadAdminSuggestions(tabContent);
    }
}

async function loadAdminUsers(tabContent) {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        const users = issues.map(i => {
            const ud = parseJsonFromIssue(i);
            return ud ? { ...ud, issueNumber: i.number } : null;
        }).filter(Boolean);

        const bannedUsers = users.filter(u => u.isBanned);
        const activeUsers = users.filter(u => !u.isBanned);

        tabContent.innerHTML = `
            <div style="margin-top:12px;">
                <input type="text" id="adminUserSearch" placeholder="搜索用户..." class="fluent-input" style="padding-left:12px;" oninput="filterAdminUsers()">
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:8px;display:flex;gap:8px;">
                <span onclick="showAdminUserList('all')" style="cursor:pointer;${users.length > 0 ? 'color:var(--accent-color);' : ''}" id="adminFilterAll">全部 (${users.length})</span>
                <span onclick="showAdminUserList('normal')" style="cursor:pointer;" id="adminFilterNormal">正常 (${activeUsers.length})</span>
                <span onclick="showAdminUserList('banned')" style="cursor:pointer;" id="adminFilterBanned">已封禁 (${bannedUsers.length})</span>
            </div>
            <div id="adminUserList" style="max-height:300px;overflow-y:auto;margin-top:8px;"></div>`;
        window._adminAllUsers = users;
        renderAdminUserList(users);
    } catch (e) {
        tabContent.innerHTML = `<p style="color:var(--danger);">加载失败: ${e.message}</p>`;
    }
}

function renderAdminUserList(users) {
    const listEl = document.getElementById('adminUserList');
    if (!listEl) return;
    listEl.innerHTML = users.map(u => `
        <div class="admin-user-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 6px;border-bottom:1px solid var(--border-light);">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="color:var(--text-primary);font-size:13px;">${escapeHtml(u.username)}</span>
                ${u.isBanned ? '<span style="color:var(--danger);font-size:11px;">已封禁</span>' : ''}
                ${isSystemAdmin(u.username) ? '<span style="color:var(--accent-color);font-size:11px;">系统管理员</span>' : ''}
            </div>
            <button onclick="toggleUserBan('${escapeHtml(u.username)}', ${u.issueNumber}, ${u.isBanned})" class="fluent-btn ${u.isBanned ? 'secondary-btn' : 'danger-btn'}" style="padding:4px 12px;font-size:11px;">
                ${u.isBanned ? '解封' : '封禁'}
            </button>
        </div>`).join('');
}

async function toggleUserBan(username, issueNumber, currentlyBanned) {
    if (isSystemAdmin(username)) { showToast('无法封禁系统管理员', 'error'); return; }
    if (!confirm(`确定要${currentlyBanned ? '解封' : '封禁'}用户 ${username} 吗？`)) return;

    try {
        const issue = await GITHUB_API.getIssue(issueNumber);
        const userData = parseJsonFromIssue(issue);
        if (!userData) { showToast('用户数据解析失败', 'error'); return; }
        userData.isBanned = !currentlyBanned;
        await GITHUB_API.updateIssue(issueNumber, buildIssueBody('用户信息', userData));
        showToast(`${currentlyBanned ? '已解封' : '已封禁'}用户 ${username}`, 'success');
        const tabContent = document.getElementById('adminTabContent');
        await loadAdminUsers(tabContent);
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

function showAdminUserAction(username) {
    // 从外部快速封禁/解封（viewProfile 调用）
    toggleUserBanFromName(username);
}

async function toggleUserBanFromName(username) {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        for (const issue of issues) {
            const ud = parseJsonFromIssue(issue);
            if (ud && ud.username === username) {
                return toggleUserBan(username, issue.number, ud.isBanned || false);
            }
        }
        showToast('未找到用户', 'error');
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function sendBroadcast() {
    const title = document.getElementById('broadcastTitle').value.trim();
    const content = document.getElementById('broadcastContent').value.trim();
    const msgDiv = document.getElementById('broadcastMsg');
    if (!title || !content) { msgDiv.innerHTML = '<span class="error">请填写标题和内容</span>'; return; }

    const broadcastData = {
        id: `broadcast_${Date.now()}`,
        title,
        content,
        createdBy: S.currentUser.username,
        createdAt: new Date().toISOString()
    };

    try {
        await GITHUB_API.createIssue(`Broadcast: ${broadcastData.id}`, buildIssueBody('系统公告', broadcastData), ['broadcast']);

        // 给所有用户发通知
        const notifyData = {
            id: `notif_${Date.now()}`,
            type: 'broadcast',
            title: '📣 系统公告',
            content: title + ': ' + content.substring(0, 100),
            targetUser: 'all',
            sender: S.currentUser.username,
            sentAt: new Date().toISOString(),
            isRead: false
        };
        await GITHUB_API.createIssue(`通知: 公告`, buildIssueBody('系统通知', notifyData), ['system_notification']);

        msgDiv.innerHTML = '<span class="success">公告发布成功！</span>';
        document.getElementById('broadcastTitle').value = '';
        document.getElementById('broadcastContent').value = '';
    } catch (e) { msgDiv.innerHTML = `<span class="error">发布失败: ${e.message}</span>`; }
}

async function loadAdminSuggestions(tabContent) {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('suggestion');
        if (issues.length === 0) {
            tabContent.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">暂无意见反馈</p>';
            return;
        }
        const suggestions = issues.map(i => {
            const sd = parseJsonFromIssue(i);
            return sd ? { ...sd, issueNumber: i.number } : null;
        }).filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        tabContent.innerHTML = `<div style="max-height:300px;overflow-y:auto;margin-top:12px;">
            ${suggestions.map(s => `
                <div style="padding:10px 6px;border-bottom:1px solid var(--border-light);">
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-primary);font-size:13px;font-weight:600;">${escapeHtml(s.title || '无标题')}</span>
                        <span style="color:var(--text-muted);font-size:11px;">${escapeHtml(s.username)} · ${formatTime(s.createdAt)}</span>
                    </div>
                    <div style="color:var(--text-secondary);font-size:12px;margin-top:4px;">${escapeHtml(s.content).substring(0, 200)}</div>
                    <div style="margin-top:6px;">
                        <select onchange="updateSuggestionStatus(${s.issueNumber}, this.value)" style="padding:4px 8px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);font-size:11px;">
                            <option value="pending" ${s.status === 'pending' ? 'selected' : ''}>待处理</option>
                            <option value="in-progress" ${s.status === 'in-progress' ? 'selected' : ''}>处理中</option>
                            <option value="completed" ${s.status === 'completed' ? 'selected' : ''}>已完成</option>
                            <option value="rejected" ${s.status === 'rejected' ? 'selected' : ''}>已拒绝</option>
                        </select>
                    </div>
                </div>`).join('')}
            </div>`;
    } catch (e) {
        tabContent.innerHTML = `<p style="color:var(--danger);">加载失败: ${e.message}</p>`;
    }
}

async function updateSuggestionStatus(issueNumber, newStatus) {
    try {
        const issue = await GITHUB_API.getIssue(issueNumber);
        const sd = parseJsonFromIssue(issue);
        if (!sd) return;
        sd.status = newStatus;
        await GITHUB_API.updateIssue(issueNumber, buildIssueBody('意见反馈', sd));
        showToast('状态已更新', 'success');
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

// 提交意见反馈
function showSubmitSuggestion() {
    showModal(
        '💡 意见反馈',
        `<div class="input-group">
            <input type="text" id="suggTitle" placeholder="标题" class="fluent-input" style="padding-left:12px;">
        </div>
        <div class="input-group" style="margin-top:8px;">
            <textarea id="suggContent" rows="4" placeholder="请详细描述你的建议或问题..." class="fluent-input" style="padding-left:12px;resize:vertical;"></textarea>
        </div>
        <div id="suggMessage" class="message-text" style="margin-top:8px;"></div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">取消</button>
         <button class="fluent-btn accent-btn" onclick="submitSuggestion()">提交</button>`
    );
}

async function submitSuggestion() {
    const title = document.getElementById('suggTitle').value.trim();
    const content = document.getElementById('suggContent').value.trim();
    const msgDiv = document.getElementById('suggMessage');
    if (!title || !content) { msgDiv.innerHTML = '<span class="error">请填写标题和内容</span>'; return; }

    const suggData = {
        id: `sugg_${Date.now()}`,
        title,
        content,
        username: S.currentUser.username,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    try {
        await GITHUB_API.createIssue(`Suggestion: ${suggData.id}`, buildIssueBody('意见反馈', suggData), ['suggestion']);
        msgDiv.innerHTML = '<span class="success">感谢反馈！管理员会尽快处理</span>';
        setTimeout(() => closeModal(), 1500);
    } catch (e) { msgDiv.innerHTML = `<span class="error">提交失败: ${e.message}</span>`; }
}
