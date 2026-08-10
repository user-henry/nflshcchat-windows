// ============================================================
// chat-room.js - 聊天室创建/加入/管理/设置
// ============================================================

async function loadRooms() {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('chatroom');
        S.allRooms = [];
        for (const issue of issues) {
            const roomData = parseJsonFromIssue(issue);
            if (!roomData) continue;
            if (roomData.type === 'private') {
                if (roomData.members && (roomData.members.includes(S.currentUser.username) || roomData.creator === S.currentUser.username)) {
                    S.allRooms.push({ ...roomData, issueNumber: issue.number });
                }
            } else if (!roomData.isBanned) {
                S.allRooms.push({ ...roomData, issueNumber: issue.number });
            }
        }
        renderRooms();
    } catch (error) { console.error('加载聊天室失败:', error); }
}

function renderRooms(filter = '') {
    const container = document.getElementById('roomsList');
    const filtered = filter ? S.allRooms.filter(r => r.name.toLowerCase().includes(filter.toLowerCase())) : S.allRooms;
    if (filtered.length === 0) {
        container.innerHTML = '<div class="loading-text">暂无聊天室<br>点击 + 按钮创建</div>';
        return;
    }
    container.innerHTML = filtered.map(room => `
        <div class="room-item ${S.currentRoom && S.currentRoom.id === room.id ? 'active' : ''}" onclick="selectRoom('${room.id}')">
            <div class="room-item-icon">${room.type === 'group' ? '👥' : '🔒'}</div>
            <div class="room-item-info">
                <div class="room-item-name">${escapeHtml(room.name)}</div>
                <div class="room-item-meta">${room.type === 'group' ? '群聊' : '私聊'} · ${room.creator === S.currentUser.username ? '我创建的' : (room.type === 'private' ? '私密' : '')}</div>
            </div>
            ${room.joinType === 'verify' ? '<span style="font-size:10px;color:#f39c12;">🔐</span>' : ''}
        </div>
    `).join('');
    renderRoomsWithNotifications();
}

function filterRooms() {
    const search = document.getElementById('roomSearch').value;
    renderRooms(search);
}

async function selectRoom(roomId) {
    const room = S.allRooms.find(r => r.id === roomId);
    if (!room) return;
    if (room.isBanned) { showToast('该群聊已被封禁', 'error'); return; }

    // 需要验证码的群聊
    if (room.joinType === 'verify' && room.type === 'group') {
        const isMember = room.members && room.members.includes(S.currentUser.username);
        if (!isMember && room.creator !== S.currentUser.username) {
            showJoinVerifyModal(room);
            return;
        }
    }

    if (S.currentRoom && S.currentRoom.id === room.id) return;

    S.currentRoom = room;
    updateChatHeader();
    document.getElementById('chatInputArea').style.display = 'block';
    document.getElementById('messagesContainer').innerHTML = '';
    await loadMessages(false);
    startPolling();
    renderRooms();
}

// ============ 创建聊天室 ============
function showCreateRoom() {
    showModal(
        '创建/加入聊天室',
        `<div class="input-group">
            <input type="text" id="newRoomName" placeholder="聊天室名称" class="fluent-input" style="padding-left:12px;">
        </div>
        <div style="display:flex; gap:8px; margin-top:8px;">
            <select id="newRoomType" onchange="toggleCreateRoomType()" style="flex:1;padding:10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);">
                <option value="group">群聊（所有人可见）</option>
                <option value="private">私聊（指定用户）</option>
            </select>
        </div>
        <div id="privateOptions" style="display:none; margin-top:8px;">
            <div class="input-group">
                <input type="text" id="privateUsername" placeholder="私聊对象用户名" class="fluent-input" style="padding-left:12px;">
            </div>
            <button class="fluent-btn secondary-btn" onclick="quickChatWithAI()" style="width:100%;margin-top:4px;">🤖 与 AI 小助手私聊</button>
        </div>
        <div id="groupOptions">
            <div style="margin-top:8px;">
                <select id="newJoinType" onchange="toggleVerifyGroup()" style="width:100%;padding:10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);">
                    <option value="public">公开（任何人可加入）</option>
                    <option value="verify">需验证码加入</option>
                </select>
            </div>
            <div id="verifyCodeGroup" style="display:none; margin-top:8px;">
                <div class="input-group">
                    <input type="text" id="customVerifyCode" placeholder="自定义验证码（留空则随机生成）" class="fluent-input" style="padding-left:12px;">
                </div>
            </div>
        </div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">取消</button>
         <button class="fluent-btn accent-btn" onclick="createRoom()">创建</button>`
    );
}

function toggleCreateRoomType() {
    const type = document.getElementById('newRoomType').value;
    document.getElementById('privateOptions').style.display = type === 'private' ? 'block' : 'none';
    document.getElementById('groupOptions').style.display = type === 'private' ? 'none' : 'block';
}

function toggleVerifyGroup() {
    document.getElementById('verifyCodeGroup').style.display = document.getElementById('newJoinType').value === 'verify' ? 'block' : 'none';
}

function quickChatWithAI() {
    document.getElementById('privateUsername').value = BOT_CONFIG.name;
    document.getElementById('newRoomName').value = `与 ${BOT_CONFIG.name} 的私聊`;
}

async function createRoom() {
    const name = document.getElementById('newRoomName').value.trim();
    const type = document.getElementById('newRoomType').value;
    const privateUser = document.getElementById('privateUsername')?.value.trim();

    if (!name) { showToast('请输入聊天室名称', 'error'); return; }

    if (type === 'private') {
        if (!privateUser) { showToast('请输入私聊对象用户名', 'error'); return; }
        if (privateUser === S.currentUser.username) { showToast('不能与自己私聊', 'error'); return; }
        if (privateUser !== BOT_CONFIG.name) {
            const userExists = await checkUserExists(privateUser);
            if (!userExists) { showToast(`用户 "${privateUser}" 不存在`, 'error'); return; }
            const isBanned = await checkUserBanned(privateUser);
            if (isBanned) { showToast(`用户 "${privateUser}" 已被封禁`, 'error'); return; }
        }
        const existing = S.allRooms.find(r =>
            r.type === 'private' && r.members &&
            r.members.includes(privateUser) && r.members.includes(S.currentUser.username)
        );
        if (existing) { showToast('已存在该私聊房间', 'info'); closeModal(); selectRoom(existing.id); return; }
    }

    const joinType = type === 'group' ? document.getElementById('newJoinType').value : null;
    const customCode = document.getElementById('customVerifyCode')?.value.trim();
    const verifyCode = (joinType === 'verify') ? (customCode || generateRandomCode()) : null;

    const roomData = {
        id: `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name, type,
        creator: S.currentUser.username,
        members: type === 'private' ? [S.currentUser.username, privateUser] : [],
        admins: [],
        joinType: type === 'group' ? joinType : null,
        verifyCode,
        announcement: '',
        isBanned: false,
        createdAt: new Date().toISOString()
    };

    try {
        await GITHUB_API.createIssue(`ChatRoom: ${roomData.id}`, buildIssueBody('聊天室信息', roomData), ['chatroom']);
        closeModal();
        await loadRooms();
        showToast('聊天室创建成功！', 'success');
    } catch (error) {
        showToast('创建失败：' + error.message, 'error');
    }
}

// ============ 群设置 ============
function showRoomSettings() {
    if (!S.currentRoom || S.currentRoom.type !== 'group') return;
    const isOwner = S.currentRoom.creator === S.currentUser.username;
    const isAdmin = S.currentRoom.admins && S.currentRoom.admins.includes(S.currentUser.username);
    const canEdit = isOwner || isAdmin;

    const admins = S.currentRoom.admins || [];
    const adminListHtml = admins.length === 0
        ? '<div style="color:var(--text-muted);padding:5px;">暂无管理员</div>'
        : admins.map(a => `<div style="display:flex;justify-content:space-between;padding:5px 0;color:var(--text-primary);"><span>${escapeHtml(a)}</span>${isOwner && a !== S.currentRoom.creator ? `<button onclick="removeAdminFromSettings('${escapeHtml(a)}')" style="background:var(--danger);color:white;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;">移除</button>` : ''}</div>`).join('');

    const contentHtml = canEdit ? `
        <div class="input-group">
            <label style="display:block;color:var(--text-secondary);margin-bottom:4px;font-size:13px;">群公告</label>
            <textarea id="roomAnnouncement" rows="3" class="fluent-input" style="padding-left:12px;resize:vertical;">${escapeHtml(S.currentRoom.announcement || '')}</textarea>
        </div>
        <div style="margin-top:8px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:4px;font-size:13px;">加入方式</label>
            <select id="editJoinType" onchange="toggleEditVerify()" style="width:100%;padding:10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);">
                <option value="public" ${S.currentRoom.joinType === 'public' ? 'selected' : ''}>公开</option>
                <option value="verify" ${S.currentRoom.joinType === 'verify' ? 'selected' : ''}>需验证码</option>
            </select>
        </div>
        <div id="editVerifyGroup" style="display:${S.currentRoom.joinType === 'verify' ? 'block' : 'none'};margin-top:8px;">
            <div class="input-group">
                <input type="text" id="editVerifyCode" placeholder="验证码" class="fluent-input" style="padding-left:12px;" value="${escapeHtml(S.currentRoom.verifyCode || '')}">
            </div>
        </div>
        <div style="margin-top:12px;">
            <label style="display:block;color:var(--text-secondary);margin-bottom:4px;font-size:13px;">群管理员</label>
            <div style="background:var(--bg-input);border-radius:8px;padding:8px;max-height:150px;overflow-y:auto;">${adminListHtml}</div>
            <div style="display:flex;gap:8px;margin-top:8px;">
                <input type="text" id="addAdminUser" placeholder="用户名" class="fluent-input" style="flex:1;padding-left:12px;">
                <button class="fluent-btn secondary-btn" onclick="addAdmin()">添加</button>
            </div>
        </div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color);">
            <button class="fluent-btn danger-btn" onclick="leaveRoom()">退出群聊</button>
        </div>
    ` : `
        <p style="color:var(--text-muted);">只有群主和管理员可以修改群设置</p>
        <button class="fluent-btn danger-btn" onclick="leaveRoom()" style="margin-top:12px;">退出群聊</button>
    `;

    showModal(`⚙️ ${escapeHtml(S.currentRoom.name)}`, contentHtml,
        canEdit ? `<button class="fluent-btn secondary-btn" onclick="closeModal()">取消</button><button class="fluent-btn accent-btn" onclick="saveRoomSettings()">保存</button>`
        : `<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>`);
}

function toggleEditVerify() {
    document.getElementById('editVerifyGroup').style.display = document.getElementById('editJoinType').value === 'verify' ? 'block' : 'none';
}

async function saveRoomSettings() {
    const announcement = document.getElementById('roomAnnouncement').value.trim();
    const joinType = document.getElementById('editJoinType').value;
    const verifyCode = document.getElementById('editVerifyCode')?.value.trim();

    S.currentRoom.announcement = announcement;
    S.currentRoom.joinType = joinType;
    if (joinType === 'verify') S.currentRoom.verifyCode = verifyCode || generateRandomCode();
    else S.currentRoom.verifyCode = null;
    S.currentRoom.updatedAt = new Date().toISOString();

    await GITHUB_API.updateIssue(S.currentRoom.issueNumber, buildIssueBody('聊天室信息', S.currentRoom));
    showToast('群设置已保存', 'success');
    closeModal();
    updateChatHeader();
}

async function addAdmin() {
    const username = document.getElementById('addAdminUser').value.trim();
    if (!username) return;
    if (!S.currentRoom.admins) S.currentRoom.admins = [];
    if (S.currentRoom.admins.includes(username)) { showToast('已是管理员', 'info'); return; }
    S.currentRoom.admins.push(username);
    await GITHUB_API.updateIssue(S.currentRoom.issueNumber, buildIssueBody('聊天室信息', S.currentRoom));
    showToast(`已添加 ${username} 为管理员`, 'success');
    closeModal();
    showRoomSettings();
}

async function removeAdminFromSettings(username) {
    if (!confirm(`确定要移除 ${username} 的管理员权限吗？`)) return;
    S.currentRoom.admins = S.currentRoom.admins.filter(a => a !== username);
    await GITHUB_API.updateIssue(S.currentRoom.issueNumber, buildIssueBody('聊天室信息', S.currentRoom));
    closeModal();
    showRoomSettings();
}

async function leaveRoom() {
    if (!confirm('确定要退出该群聊吗？')) return;
    if (S.currentRoom.members) S.currentRoom.members = S.currentRoom.members.filter(m => m !== S.currentUser.username);
    await GITHUB_API.updateIssue(S.currentRoom.issueNumber, buildIssueBody('聊天室信息', S.currentRoom));
    showToast('已退出群聊', 'info');
    closeModal();
    await loadRooms();
    S.currentRoom = null;
    updateChatHeader();
    document.getElementById('chatInputArea').style.display = 'none';
    document.getElementById('messagesContainer').innerHTML = `
        <div class="empty-chat-state"><div class="empty-chat-icon">💬</div>
        <h2>欢迎使用 NFLSHC Chat</h2><p>选择一个聊天室开始对话，或创建一个新群聊</p></div>`;
    if (S.pollInterval) clearInterval(S.pollInterval);
}

// ============ 加入群聊（验证码） ============
function showJoinVerifyModal(room) {
    showModal(
        `加入群聊「${escapeHtml(room.name)}」`,
        `<p style="color:var(--text-secondary);margin-bottom:12px;">该群聊需要验证码才能加入</p>
         <div class="input-group"><input type="text" id="joinVerifyCode" placeholder="请输入验证码" class="fluent-input" style="padding-left:12px;"></div>
         <div id="joinMessage" class="message-text" style="margin-top:8px;"></div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">取消</button>
         <button class="fluent-btn accent-btn" onclick="confirmJoinRoom('${room.id}')">加入</button>`
    );
}

async function confirmJoinRoom(roomId) {
    const code = document.getElementById('joinVerifyCode').value.trim();
    const room = S.allRooms.find(r => r.id === roomId);
    if (!room) return;
    if (code !== room.verifyCode) {
        document.getElementById('joinMessage').innerHTML = '<span class="error">验证码错误</span>';
        return;
    }
    await doJoinRoom(room);
    closeModal();
    await loadRooms();
    await selectRoom(roomId);
}

async function doJoinRoom(room) {
    if (!room.members) room.members = [];
    if (room.members.includes(S.currentUser.username)) return;
    room.members.push(S.currentUser.username);
    await GITHUB_API.updateIssue(room.issueNumber, buildIssueBody('聊天室信息', room));
    showToast(`已加入群聊「${room.name}」`, 'success');
}
