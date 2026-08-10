// ============================================================
// profile.js - 个人资料 / 编辑 / 好友系统 / 查看他人资料
// ============================================================

// ============ 查看他人资料 ============
function isBotName(name) {
    if (!name) return false;
    if (name === BOT_CONFIG?.name) return true;
    // 兜底：用户名命中机器人触发词（兼容历史消息里 AI 用过不同名字，如含 “AI”“机器人” 等）
    const triggers = BOT_CONFIG?.triggerWords || [];
    const lower = name.toLowerCase();
    return triggers.some(t => t.length >= 2 && lower.includes(t.toLowerCase()));
}

async function viewProfile(username) {
    if (username === S.currentUser?.username) { showProfile(); return; }

    // AI 机器人特殊处理（与 web 版一致：打开介绍页）
    if (isBotName(username)) {
        showBotProfile();
        return;
    }

    const user = await findUserByName(username);
    if (!user) {
        showToast('用户不存在', 'error');
        return;
    }

    const avatarUrl = user.avatarUrl || SITE_LOGO;
    const msgCount = S.globalMsgCounts[username] || 0;
    const isAdmin = isSystemAdmin(username);
    const adminBadge = isAdmin ? '<span class="admin-badge" style="margin:4px auto;display:inline-block;">管理员</span>' : '';

    // 检查好友状态
    let friendStatusHtml = '';
    if (username !== S.currentUser.username && username !== BOT_CONFIG.name && !isSystemAdmin(username)) {
        const isPending = await checkFriendRequestPending(S.currentUser.username, username);
        const isFriend = await checkIsFriend(S.currentUser.username, username);
        if (isFriend) friendStatusHtml = '<p style="color:var(--success);margin-top:4px;">✅ 已是好友</p>';
        else if (isPending) friendStatusHtml = '<p style="color:var(--warning);margin-top:4px;">⏳ 好友申请已发送</p>';
        else friendStatusHtml = `<button onclick="closeModal();sendFriendRequest('${username}')" class="fluent-btn accent-btn" style="margin-top:8px;">添加好友</button>`;
    }

    showModal(
        `👤 ${escapeHtml(username)} 的资料`,
        `<div style="text-align:center;">
            <div class="profile-avatar" style="background-image:url('${avatarUrl}');"></div>
            <h2 style="color:var(--accent-color);margin-bottom:4px;">${escapeHtml(username)}</h2>
            ${adminBadge}
            <p style="color:var(--text-muted);margin-top:6px;">消息数: ${msgCount}</p>
            ${user.bio ? `<p style="color:var(--text-secondary);margin-top:8px;background:var(--bg-input);padding:8px 12px;border-radius:8px;">${escapeHtml(user.bio)}</p>` : ''}
            <p style="color:var(--text-muted);margin-top:8px;font-size:12px;">注册时间: ${new Date(user.createdAt).toLocaleDateString('zh-CN')}</p>
            ${friendStatusHtml}
            ${S.currentUser.isAdmin || isSystemAdmin(S.currentUser?.username) ? `
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color);">
                <button onclick="closeModal();showAdminUserAction('${username}')" class="fluent-btn ${user.isBanned ? 'secondary-btn' : 'danger-btn'}" style="font-size:12px;padding:6px 14px;">
                    ${user.isBanned ? '🔓 解封用户' : '🔨 封禁用户'}
                </button>
            </div>` : ''}
        </div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>`
    );
}

// ============ AI 机器人介绍页 ============
function showBotProfile() {
    const avatarUrl = SITE_LOGO;
    showModal(
        `🤖 ${escapeHtml(BOT_CONFIG.name)} 的资料`,
        `<div style="text-align:center;">
            <div class="profile-avatar" style="background-image:url('${avatarUrl}');"></div>
            <h2 style="color:var(--accent-color);margin-bottom:4px;">${escapeHtml(BOT_CONFIG.name)}</h2>
            <div style="display:flex;gap:6px;justify-content:center;margin-top:4px;">
                <span class="bot-badge" style="display:inline-block;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:bold;">AI 机器人</span>
            </div>
            <p style="color:var(--text-secondary);margin-top:12px;background:var(--bg-input);padding:10px 14px;border-radius:8px;line-height:1.6;">
                ${escapeHtml(BOT_CONFIG.name)} 是 NFLSHC Chat 的 AI 智能助手，基于思知 API 驱动。<br><br>
                <b>功能：</b><br>
                • 在群聊中 @${escapeHtml(BOT_CONFIG.name)} 可触发智能对话<br>
                • 支持日程提醒（如"提醒我 15:30 开会"）<br>
                • 私聊中自动回答你的问题<br>
                • 知识百科、翻译、计算等多种能力
            </p>
            <p style="color:var(--text-muted);margin-top:8px;font-size:12px;">版本: v2.3.0 | 始终在线</p>
        </div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>
         <button class="fluent-btn accent-btn" onclick="closeModal();startAIChat()">💬 私聊 ${escapeHtml(BOT_CONFIG.name)}</button>`
    );
}

// ============ 快速私聊 AI ============
async function startAIChat() {
    const existing = S.allRooms.find(r =>
        r.type === 'private' && r.members &&
        r.members.includes(BOT_CONFIG.name) && r.members.includes(S.currentUser.username)
    );
    if (existing) { selectRoom(existing.id); return; }

    const roomData = {
        id: `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `${S.currentUser.username} 与 ${BOT_CONFIG.name}`,
        type: 'private',
        creator: S.currentUser.username,
        members: [S.currentUser.username, BOT_CONFIG.name],
        admins: [],
        joinType: null,
        verifyCode: null,
        announcement: '',
        isBanned: false,
        createdAt: new Date().toISOString()
    };
    try {
        await GITHUB_API.createIssue(`ChatRoom: ${roomData.id}`, buildIssueBody('聊天室信息', roomData), ['chatroom']);
        await loadRooms();
        selectRoom(roomData.id);
    } catch (e) { showToast('创建聊天失败: ' + e.message, 'error'); }
}

// ============ 个人资料弹窗 ============
async function showProfile() {
    const profile = await loadUserProfile();
    if (!profile) { showToast('无法加载个人资料', 'error'); return; }

    const msgCount = S.globalMsgCounts[S.currentUser.username] || 0;
    const avatarUrl = profile.avatarUrl || SITE_LOGO;
    const isAdmin = isSystemAdmin(S.currentUser.username) || S.currentUser.isAdmin;
    const adminBadge = isAdmin ? '<span class="admin-badge" style="margin:4px auto;display:inline-block;">管理员</span>' : '';

    showModal(
        '👤 个人资料',
        `<div style="text-align:center;">
            <div class="profile-avatar" style="background-image:url('${avatarUrl}');"></div>
            <h2 style="color:var(--accent-color);margin-bottom:4px;">${escapeHtml(profile.username)}</h2>
            ${adminBadge}
            <p style="color:var(--text-muted);margin-top:6px;">消息数: ${msgCount}</p>
            ${profile.bio ? `<p style="color:var(--text-secondary);margin-top:8px;background:var(--bg-input);padding:8px 12px;border-radius:8px;">${escapeHtml(profile.bio)}</p>` : '<p style="color:var(--text-muted);margin-top:8px;">还没有个人简介</p>'}
            <p style="color:var(--text-muted);margin-top:8px;font-size:12px;">注册时间: ${new Date(profile.createdAt).toLocaleDateString('zh-CN')}</p>
            <p style="color:var(--text-muted);font-size:12px;">邮箱: ${escapeHtml(profile.email || '未设置')}</p>
            ${isAdmin ? '<button onclick="closeModal();showAdminPanel()" class="fluent-btn accent-btn" style="margin-top:12px;">🔧 管理后台</button>' : ''}
            <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;">
                <button onclick="closeModal();showAnnouncements()" class="fluent-btn secondary-btn" style="font-size:13px;padding:6px 16px;">📢 查看公告</button>
                <button onclick="closeModal();logout()" class="fluent-btn danger-btn" style="font-size:13px;padding:6px 16px;">🚪 退出登录</button>
            </div>
        </div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>
         <button class="fluent-btn accent-btn" onclick="closeModal();showEditProfile()">编辑资料</button>`
    );
}

// ============ 编辑资料 ============
async function showEditProfile() {
    const profile = await loadUserProfile();
    if (!profile) return;

    showModal(
        '✏️ 编辑个人资料',
        `<div class="input-group">
            <label style="display:block;color:var(--text-secondary);margin-bottom:4px;font-size:13px;">头像URL</label>
            <input type="text" id="editAvatarUrl" class="fluent-input" style="padding-left:12px;" value="${escapeHtml(profile.avatarUrl || '')}" placeholder="输入头像图片URL">
        </div>
        <div class="input-group" style="margin-top:8px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:4px;font-size:13px;">个人简介</label>
            <textarea id="editBio" rows="3" class="fluent-input" style="padding-left:12px;resize:vertical;">${escapeHtml(profile.bio || '')}</textarea>
        </div>
        <div class="input-group" style="margin-top:8px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:4px;font-size:13px;">邮箱</label>
            <input type="email" id="editEmail" class="fluent-input" style="padding-left:12px;" value="${escapeHtml(profile.email || '')}">
        </div>
        <div class="input-group" style="margin-top:8px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:4px;font-size:13px;">新密码（留空不修改）</label>
            <input type="password" id="editPassword" class="fluent-input" style="padding-left:12px;" placeholder="输入新密码">
        </div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">取消</button>
         <button class="fluent-btn accent-btn" onclick="saveProfile()">保存</button>`
    );
}

async function saveProfile() {
    const profile = await loadUserProfile();
    if (!profile) return;

    const avatarUrl = document.getElementById('editAvatarUrl').value.trim();
    const bio = document.getElementById('editBio').value.trim();
    const email = document.getElementById('editEmail').value.trim();
    const newPassword = document.getElementById('editPassword').value;

    if (avatarUrl) profile.avatarUrl = avatarUrl;
    profile.bio = bio;
    if (email) profile.email = email;
    if (newPassword) profile.password = newPassword;

    await GITHUB_API.updateIssue(profile.issueNumber, buildIssueBody('用户信息', profile));
    if (profile.avatarUrl) S.userAvatarCache[S.currentUser.username] = profile.avatarUrl;
    document.getElementById('sidebarAvatar').style.backgroundImage = `url('${profile.avatarUrl || SITE_LOGO}')`;
    showToast('个人资料已更新', 'success');
    closeModal();
    showProfile();
}

// ============ 好友系统 ============
async function sendFriendRequest(username) {
    if (username === S.currentUser.username) { showToast('不能添加自己为好友', 'error'); return; }

    const existingRequest = await checkFriendRequestPending(S.currentUser.username, username);
    if (existingRequest) { showToast('已发送过好友申请', 'info'); return; }

    const alreadyFriend = await checkIsFriend(S.currentUser.username, username);
    if (alreadyFriend) { showToast('你们已经是好友了', 'info'); return; }

    const requestData = {
        id: `freq_${Date.now()}`,
        from: S.currentUser.username,
        to: username,
        status: 'pending',
        createdAt: new Date().toISOString()
    };

    await GITHUB_API.createIssue(`FriendRequest: ${requestData.id}`, buildIssueBody('好友申请', requestData), ['friend_request']);
    showToast('好友申请已发送！', 'success');
}

async function checkFriendRequestPending(user1, user2) {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('friend_request');
        for (const issue of issues) {
            const req = parseJsonFromIssue(issue);
            if (req && req.from === user1 && req.to === user2 && req.status === 'pending') return true;
        }
        return false;
    } catch (e) { return false; }
}

async function checkIsFriend(user1, user2) {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('friend');
        for (const issue of issues) {
            const f = parseJsonFromIssue(issue);
            if (f && ((f.user1 === user1 && f.user2 === user2) || (f.user1 === user2 && f.user2 === user1))) return true;
        }
        return false;
    } catch (e) { return false; }
}

async function showFriends() {
    showModal('👥 好友列表', '<div class="loading-text">加载中...</div>', '<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>');

    try {
        // 获取好友
        const { data: friendIssues } = await GITHUB_API.getAllIssues('friend');
        const friends = [];
        for (const issue of friendIssues) {
            const friendData = parseJsonFromIssue(issue);
            if (friendData && (friendData.user1 === S.currentUser.username || friendData.user2 === S.currentUser.username)) {
                const friendName = friendData.user1 === S.currentUser.username ? friendData.user2 : friendData.user1;
                friends.push({ ...friendData, friendName });
            }
        }

        // 获取好友申请
        const { data: reqIssues } = await GITHUB_API.getAllIssues('friend_request');
        const incomingRequests = [];
        const outgoingRequests = [];
        for (const issue of reqIssues) {
            const req = parseJsonFromIssue(issue);
            if (req && req.status === 'pending') {
                if (req.to === S.currentUser.username) incomingRequests.push({ ...req, issueNumber: issue.number });
                if (req.from === S.currentUser.username) outgoingRequests.push(req);
            }
        }

        let contentHtml = '';

        // 显示好友
        if (friends.length === 0) {
            contentHtml += '<p style="color:var(--text-muted);text-align:center;padding:10px;">暂无好友</p>';
        } else {
            contentHtml += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">已添加的好友 (' + friends.length + ')</div>';
            contentHtml += friends.map(f => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid var(--border-light);justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="closeModal();viewProfile('${escapeHtml(f.friendName)}')">
                        <div class="friend-mini-avatar">👤</div>
                        <span style="color:var(--text-primary);">${escapeHtml(f.friendName)}</span>
                    </div>
                    <button onclick="startPrivateChat('${escapeHtml(f.friendName)}')" style="background:var(--accent-color);color:var(--text-inverse);border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;">私聊</button>
                </div>`).join('');
        }

        // 显示收到的申请
        if (incomingRequests.length > 0) {
            contentHtml += '<div style="font-size:12px;color:var(--warning);margin-top:16px;margin-bottom:8px;">收到的申请 (' + incomingRequests.length + ')</div>';
            contentHtml += incomingRequests.map(r => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid var(--border-light);justify-content:space-between;">
                    <span style="color:var(--text-primary);">${escapeHtml(r.from)}</span>
                    <div style="display:flex;gap:4px;">
                        <button onclick="handleFriendRequest(${r.issueNumber}, 'accept')" style="background:var(--success);color:white;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;">接受</button>
                        <button onclick="handleFriendRequest(${r.issueNumber}, 'reject')" style="background:var(--danger);color:white;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;">拒绝</button>
                    </div>
                </div>`).join('');
        }

        if (outgoingRequests.length > 0) {
            contentHtml += '<div style="font-size:12px;color:var(--text-muted);margin-top:16px;margin-bottom:8px;">发出的申请 (' + outgoingRequests.length + ')</div>';
            contentHtml += outgoingRequests.map(r => `
                <div style="display:flex;align-items:center;gap:8px;padding:8px 6px;border-bottom:1px solid var(--border-light);">
                    <span style="color:var(--text-muted);">${escapeHtml(r.to)} ⏳</span>
                </div>`).join('');
        }

        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">👥 好友</h3>
            <div style="max-height:350px;overflow-y:auto;">${contentHtml}</div>
            <div class="modal-actions">
                <button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>
            </div>`;
    } catch (e) {
        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">👥 好友</h3>
            <p style="color:var(--error);">加载失败: ${e.message}</p>
            <div class="modal-actions"><button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button></div>`;
    }
}

async function handleFriendRequest(issueNumber, action) {
    try {
        const issue = await GITHUB_API.getIssue(issueNumber);
        const req = parseJsonFromIssue(issue);
        if (!req) return;

        if (action === 'accept') {
            // 创建好友关系
            const friendData = {
                id: `friend_${Date.now()}`,
                user1: req.from,
                user2: req.to,
                createdAt: new Date().toISOString()
            };
            await GITHUB_API.createIssue(`Friend: ${friendData.id}`, buildIssueBody('好友关系', friendData), ['friend']);
            showToast('已添加好友！', 'success');
        }
        // 关闭申请
        await GITHUB_API.closeIssue(issueNumber);
        closeModal();
        showFriends();
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

async function startPrivateChat(username) {
    // 查找或创建私聊房间
    const existing = S.allRooms.find(r =>
        r.type === 'private' && r.members &&
        r.members.includes(username) && r.members.includes(S.currentUser.username)
    );
    if (existing) { closeModal(); selectRoom(existing.id); return; }

    const roomData = {
        id: `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `${S.currentUser.username} 与 ${username} 的私聊`,
        type: 'private',
        creator: S.currentUser.username,
        members: [S.currentUser.username, username],
        admins: [],
        joinType: null,
        verifyCode: null,
        announcement: '',
        isBanned: false,
        createdAt: new Date().toISOString()
    };

    try {
        await GITHUB_API.createIssue(`ChatRoom: ${roomData.id}`, buildIssueBody('聊天室信息', roomData), ['chatroom']);
        closeModal();
        await loadRooms();
        selectRoom(roomData.id);
    } catch (e) { showToast('创建私聊失败: ' + e.message, 'error'); }
}
