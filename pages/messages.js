// ============================================================
// messages.js - 消息收发 / 渲染 / 轮询 / 撤回 / 收藏 / 置顶
// ============================================================

// ============ 聊天头部 ============
function updateChatHeader() {
    const header = document.getElementById('chatHeaderBar');
    const actions = document.getElementById('chatHeaderActions');
    if (!S.currentRoom) {
        header.querySelector('.chat-header-content').innerHTML = '<h3 class="chat-header-title">选择聊天室</h3>';
        actions.innerHTML = '';
        return;
    }
    let subtitle = S.currentRoom.type === 'private' ? '私聊 · 仅你们两人可见'
        : '群聊' + (S.currentRoom.announcement ? ' · 📢 ' + escapeHtml(S.currentRoom.announcement).substring(0, 30) : '');
    header.querySelector('.chat-header-content').innerHTML = `
        <h3 class="chat-header-title">${escapeHtml(S.currentRoom.name)}</h3>
        <div class="chat-header-subtitle">${subtitle}</div>`;
    actions.innerHTML = S.currentRoom.type === 'group'
        ? '<button class="icon-btn" title="群设置" onclick="showRoomSettings()">⚙️</button>'
        : '';
}

// ============ 消息加载 ============
async function loadHistoryMessages(page = 1) {
    if (!S.currentRoom) return { messages: [], hasNext: false };
    try {
        const { data: issues, linkHeader } = await GITHUB_API.getIssues('chatmessage', { per_page: 50, page });
        const roomMessages = [];
        for (const issue of issues) {
            const msgData = parseJsonFromIssue(issue);
            if (msgData && msgData.roomId === S.currentRoom.id && !msgData.isRecalled) {
                roomMessages.push({ ...msgData, issueNumber: issue.number });
            }
        }
        return { messages: roomMessages, hasNext: linkHeader && linkHeader.includes('rel="next"') };
    } catch (error) { console.error('加载历史消息失败:', error); return { messages: [], hasNext: false }; }
}

async function loadNewMessages() {
    if (!S.currentRoom) return [];
    try {
        // 新后端：legacy issues 兼容层，一次性返回全部，按 id 去重即可
        const { data: issues } = await GITHUB_API.getIssues('chatmessage');
        const newMessages = [];
        for (const issue of issues) {
            const msgData = parseJsonFromIssue(issue);
            if (msgData && msgData.roomId === S.currentRoom.id && !msgData.isRecalled) {
                if (!S.allMessages.some(m => m.id === msgData.id)) {
                    newMessages.push({ ...msgData, issueNumber: issue.number });
                }
            }
        }
        return newMessages;
    } catch (error) { console.error('加载新消息失败:', error); return []; }
}

async function loadMessages() {
    if (!S.currentRoom) return;
    const container = document.getElementById('messagesContainer');

    // 暂停轮询，防止竞态导致消息重复
    const wasPolling = !!S.pollInterval;
    if (wasPolling) {
        clearInterval(S.pollInterval);
        S.pollInterval = null;
    }
    S._loadingMessages = true;

    container.innerHTML = '<div class="loading-text">加载中...</div>';
    S.currentPage = 1;
    S.hasMoreMessages = true;
    S.allMessages = [];
    S.newestMessageTimestamp = null;

    // 循环加载所有历史消息页
    try {
        while (true) {
            const result = await loadHistoryMessages(S.currentPage);
            if (!result || !result.messages) break;
            result.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            S.allMessages = [...S.allMessages, ...result.messages];
            // 注意：某一页的原始评论可能全部属于其他聊天室，导致本房间该页为空，
            // 但这不代表后续页没有本房间的历史消息。因此不能以“本页为空”提前退出，
            // 必须以 GitHub 原始分页的 hasNext 为准，翻完所有页才能加载到最古老的历史。
            if (!result.hasNext) {
                S.hasMoreMessages = false;
                break;
            }
            S.currentPage++;
        }

        if (S.allMessages.length > 0) {
            // 按 ID 去重，防止并发时混入重复消息
            const seen = new Set();
            S.allMessages = S.allMessages.filter(m => {
                if (seen.has(m.id)) return false;
                seen.add(m.id);
                return true;
            });

            S.allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            S.newestMessageTimestamp = S.allMessages[S.allMessages.length - 1].timestamp;
            const senders = [...new Set(S.allMessages.map(m => m.sender))];
            await loadUserAvatars(senders);
            renderMessages();
        } else {
            container.innerHTML = '<div class="empty-chat-state"><div class="empty-chat-icon">💬</div><p>暂无消息，发送第一条消息吧！</p></div>';
        }
    } catch (error) {
        console.error('加载历史消息失败:', error);
        container.innerHTML = '<div class="empty-chat-state"><p style="color:var(--danger);">加载消息失败</p></div>';
    }

    S._loadingMessages = false;

    // 恢复轮询
    if (wasPolling && S.currentRoom) {
        S.pollInterval = setInterval(async () => {
            if (S.currentRoom && !S.currentRoom.isBanned) await pollNewMessages();
        }, 3000);
    }
}

// 已改为进入聊天室即加载全部消息，loadMoreMessages 保留签名但不再执行分页
function loadMoreMessages() {
    // no-op: 所有消息已在进入房间时加载完成
}

async function pollNewMessages() {
    if (!S.currentRoom || S._loadingMessages) return;
    const newMessages = await loadNewMessages();
    if (newMessages.length > 0) {
        newMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        // 二次去重：只添加 S.allMessages 中不存在的消息
        const existingIds = new Set(S.allMessages.map(m => m.id));
        const trulyNew = newMessages.filter(m => !existingIds.has(m.id));
        if (trulyNew.length === 0) return;
        S.allMessages.push(...trulyNew);
        S.newestMessageTimestamp = trulyNew[trulyNew.length - 1].timestamp;
        const newSenders = [...new Set(trulyNew.map(m => m.sender))];
        await loadUserAvatars(newSenders);
        renderMessages();
        smartScrollToBottom();
    }
}

// ============ 滚动控制 ============
function smartScrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (!container || S.isUserScrolling) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) container.scrollTop = container.scrollHeight;
}

function setupScrollDetection() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;
    container.addEventListener('scroll', () => {
        S.isUserScrolling = true;
        if (S.scrollTimeout) clearTimeout(S.scrollTimeout);
        S.scrollTimeout = setTimeout(() => { S.isUserScrolling = false; }, 3000);
    });
    container.addEventListener('mouseenter', () => { S.isUserScrolling = true; });
    container.addEventListener('mouseleave', () => {
        setTimeout(() => {
            if (S.scrollTimeout) clearTimeout(S.scrollTimeout);
            S.scrollTimeout = setTimeout(() => { S.isUserScrolling = false; }, 1000);
        }, 500);
    });
}

function scrollToMessage(msgId) {
    const el = document.getElementById('msg-' + msgId);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.background = 'var(--accent-light)';
        setTimeout(() => { el.style.background = ''; }, 2000);
    }
}

// ============ Markdown 渲染 ============
function renderMarkdown(content) {
    if (!content) return '';
    const mentionPattern = /(@[a-zA-Z0-9_\u4e00-\u9fa5]+|@所有人)/g;
    const mentions = [];
    let tempContent = content.replace(mentionPattern, (match) => {
        mentions.push(match);
        return `\u200B\u200BMENTION_${mentions.length - 1}\u200B\u200B`;
    });

    let html = tempContent;
    if (typeof marked !== 'undefined') {
        try {
            marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
            const parsed = marked.parse(tempContent);
            if (parsed && typeof parsed.then !== 'function') html = parsed;
        } catch (e) { }
    }

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    for (let i = 0; i < mentions.length; i++) {
        const mention = mentions[i];
        const cls = mention === '@所有人' ? 'mention-all' : 'mention';
        const regex = new RegExp(`\u200B\u200BMENTION_${i}\u200B\u200B`, 'g');
        html = html.replace(regex, `<span class="${cls}">${mention}</span>`);
    }
    return html;
}

// ============ 消息渲染 ============
function renderMessages() {
    const container = document.getElementById('messagesContainer');
    const roomMessages = S.allMessages || [];

    const pinnedMessages = roomMessages.filter(m => m.isPinned && !m.isRecalled);
    let pinnedHtml = '';
    if (pinnedMessages.length > 0 && S.currentRoom && S.currentRoom.type === 'group') {
        const canPin = S.currentRoom.creator === S.currentUser.username || (S.currentRoom.admins && S.currentRoom.admins.includes(S.currentUser.username));
        pinnedHtml = pinnedMessages.map(msg => `
            <div style="background:linear-gradient(135deg, #7c3aed, #6d28d9);color:white;padding:8px 14px;border-radius:8px;margin-bottom:8px;display:flex;align-items:center;gap:8px;font-size:13px;">
                <span>📌</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;" onclick="scrollToMessage('${msg.id}')">${escapeHtml(msg.content).substring(0, 100)}</span>
                <span style="font-size:11px;opacity:0.7;">${escapeHtml(msg.sender)}</span>
                ${canPin ? `<button onclick="togglePin('${msg.id}')" style="background:rgba(255,255,255,0.2);border:none;color:white;border-radius:4px;cursor:pointer;font-size:11px;padding:2px 6px;">取消</button>` : ''}
            </div>`).join('');
    }

    if (roomMessages.length === 0 && !pinnedHtml) {
        container.innerHTML = '<div class="empty-chat-state"><div class="empty-chat-icon">💬</div><p>暂无消息，发送第一条消息吧！</p></div>';
        return;
    }

    container.innerHTML = pinnedHtml + roomMessages.map(msg => {
        const renderedHtml = renderMarkdown(msg.content);
        let bubbleContent = renderedHtml;

        if (msg.isVoice && msg.voiceData) {
            bubbleContent = `<div><audio controls src="${msg.voiceData}" style="max-width:250px;height:40px;"></audio><div style="font-size:11px;color:var(--text-muted);">${escapeHtml(msg.content)}</div></div>`;
        }

        if (msg.isRecalled) {
            return `<div class="message-row" style="align-self:center;"><div class="message-recalled" style="color:var(--text-muted);font-style:italic;padding:4px 12px;background:var(--bg-tertiary);border-radius:12px;">${escapeHtml(msg.sender)} 撤回了一条消息</div></div>`;
        }

        const canRecall = msg.sender === S.currentUser.username && (Date.now() - new Date(msg.timestamp).getTime() < 120000);
        const isOwn = msg.sender === S.currentUser.username;
        const canPin = S.currentRoom && S.currentRoom.type === 'group' && (S.currentRoom.creator === S.currentUser.username || (S.currentRoom.admins && S.currentRoom.admins.includes(S.currentUser.username)));

        let replyQuote = '';
        if (msg.replyTo) {
            const origMsg = roomMessages.find(m => m.id === msg.replyTo);
            if (origMsg) {
                replyQuote = `<div class="reply-quote" onclick="scrollToMessage('${origMsg.id}')">${escapeHtml(origMsg.sender)}：${escapeHtml(origMsg.content).substring(0, 100)}</div>`;
            }
        }

        const senderMsgCount = S.globalMsgCounts[msg.sender] || 0;
        const senderLevel = calculateLevel(senderMsgCount);
        const levelBadge = `<span class="level-badge ${getLevelClass(senderLevel)}">Lv.${senderLevel}</span>`;
        const avatarUrl = S.userAvatarCache[msg.sender] || SITE_LOGO;
        const isAdminMsg = isSystemAdmin(msg.sender);
        const adminBadge = isAdminMsg ? '<span class="admin-badge">管理员</span>' : '';
        const isAiBot = isBotName(msg.sender);
        const botBadge = isAiBot ? '<span class="bot-badge">AI</span>' : '';

        return `
        <div class="message-row ${isOwn ? 'own' : ''}" id="msg-${msg.id}">
            <div class="message-header">
                <div class="message-avatar" style="background-image:url('${avatarUrl}')" onclick="viewProfile('${escapeHtml(msg.sender)}')" title="查看 ${escapeHtml(msg.sender)} 的资料"></div>
                <span class="message-sender" onclick="viewProfile('${escapeHtml(msg.sender)}')">${escapeHtml(msg.sender)}</span>${adminBadge}${botBadge}${levelBadge}
            </div>
            <div class="message-bubble">
                ${replyQuote}
                ${bubbleContent}
            </div>
            <div class="message-time">${formatTime(msg.timestamp)}</div>
            <div class="message-actions">
                ${canRecall ? `<button class="message-action-btn recall" onclick="recallMessage('${msg.id}')">撤回</button>` : ''}
                <button class="message-action-btn reply" onclick="setReplyTo('${msg.id}')">回复</button>
                <button class="message-action-btn favorite" onclick="favoriteMessage('${msg.id}')">收藏</button>
                ${canPin ? `<button class="message-action-btn" onclick="togglePin('${msg.id}')" style="color:#9b59b6;">${msg.isPinned ? '取消置顶' : '置顶'}</button>` : ''}
            </div>
        </div>`;
    }).join('');

    smartScrollToBottom();
}

// ============ 发送消息 ============
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const content = input.value.trim();
    if (!content || !S.currentRoom) return;

    const isBanned = await checkUserBanned(S.currentUser.username);
    if (isBanned) { showToast('您的账号已被封禁，无法发送消息', 'error'); return; }

    let mentionedUsers = [];
    const mentionPattern = /@([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
    const userMentions = [...content.matchAll(mentionPattern)].map(m => m[1]);
    mentionedUsers.push(...userMentions);
    const hasMentionAll = content.includes('@所有人');
    if (hasMentionAll && S.currentRoom.type === 'group') {
        const allMembers = getGroupActiveMembers(S.currentRoom.id);
        mentionedUsers = [...new Set([...mentionedUsers, ...allMembers.filter(m => m !== S.currentUser.username)])];
    }

    const messageData = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomId: S.currentRoom.id,
        sender: S.currentUser.username,
        content,
        mentions: mentionedUsers,
        hasMentionAll,
        replyTo: S.replyToMessage ? S.replyToMessage.id : null,
        timestamp: new Date().toISOString(),
        isRecalled: false,
        isPinned: false
    };

    try {
        await GITHUB_API.createIssue(`Message: ${messageData.id}`, buildIssueBody('聊天消息', messageData), ['chatmessage']);

        for (const mentionedUser of mentionedUsers) {
            if (mentionedUser === S.currentUser.username) continue;
            const userExists = await checkUserExists(mentionedUser);
            if (userExists || isSystemAdmin(mentionedUser)) {
                await sendMentionNotification(mentionedUser, S.currentUser.username, S.currentRoom.name, S.currentRoom.id);
            }
        }

        input.value = '';
        S.replyToMessage = null;
        document.getElementById('replyPreview').classList.remove('show');
        updateMarkdownPreview();
        await pollNewMessages();

        // AI 自动回复
        setTimeout(() => {
            if (S.currentRoom) {
                if (S.currentRoom.type === 'group') triggerAIReply(S.currentRoom.id, S.currentUser.username, content);
                else if (S.currentRoom.type === 'private') {
                    const otherUser = S.currentRoom.members?.find(m => m !== S.currentUser.username);
                    if (otherUser === BOT_CONFIG.name) handlePrivateAIChat(content);
                }
            }
        }, 500);
    } catch (error) { showToast('发送失败：' + error.message, 'error'); }
}

// ============ 撤回消息 ============
async function recallMessage(messageId) {
    const msg = S.allMessages.find(m => m.id === messageId);
    if (!msg || msg.sender !== S.currentUser.username) return;
    if (Date.now() - new Date(msg.timestamp).getTime() > 120000) {
        showToast('只能撤回2分钟内的消息', 'error'); return;
    }
    if (!msg.issueNumber) { showToast('无法找到消息记录', 'error'); return; }
    msg.isRecalled = true;
    await GITHUB_API.updateIssue(msg.issueNumber, buildIssueBody('聊天消息', msg));
    renderMessages();
}

// ============ 引用回复 ============
function setReplyTo(messageId) {
    const msg = S.allMessages.find(m => m.id === messageId);
    if (!msg) return;
    S.replyToMessage = msg;
    document.getElementById('replyPreviewContent').textContent = '回复 ' + msg.sender + '：' + msg.content.substring(0, 80);
    document.getElementById('replyPreview').classList.add('show');
    document.getElementById('messageInput').focus();
}

function cancelReply() {
    S.replyToMessage = null;
    document.getElementById('replyPreview').classList.remove('show');
}

// ============ 置顶消息 ============
async function togglePin(messageId) {
    const msg = S.allMessages.find(m => m.id === messageId);
    if (!msg) return;
    msg.isPinned = !msg.isPinned;
    try {
        let found = false;
        const { data: issues } = await GITHUB_API.getAllIssues('chatmessage');
        for (const issue of issues) {
            if (issue.title === 'Message: ' + msg.id) {
                await GITHUB_API.updateIssue(issue.number, buildIssueBody('聊天消息', msg));
                found = true;
                showToast(msg.isPinned ? '已置顶 📌' : '已取消置顶', 'success');
                break;
            }
        }
        if (!found) showToast('未找到消息记录', 'error');
        renderMessages();
    } catch (e) { showToast('置顶失败：' + e.message, 'error'); }
}

// ============ 收藏消息 ============
async function favoriteMessage(messageId) {
    const msg = S.allMessages.find(m => m.id === messageId);
    if (!msg) { showToast('消息不存在', 'error'); return; }
    const favoriteData = {
        id: `fav_${Date.now()}`,
        messageId: msg.id,
        roomId: msg.roomId,
        sender: msg.sender,
        content: msg.content,
        userName: S.currentUser.username,
        createdAt: new Date().toISOString()
    };
    await GITHUB_API.createIssue(`Favorite: ${favoriteData.id}`, buildIssueBody('收藏消息', favoriteData), ['favorite']);
    showToast('已收藏 ⭐', 'success');
}

// ============ 辅助 ============
function getGroupActiveMembers(roomId) {
    const senders = S.allMessages.filter(m => m.roomId === roomId && !m.isRecalled).map(m => m.sender);
    const uniqueMembers = [...new Set(senders)];
    const room = S.allRooms.find(r => r.id === roomId);
    if (room && room.creator && !uniqueMembers.includes(room.creator)) uniqueMembers.push(room.creator);
    return uniqueMembers;
}

function updateMarkdownPreview() {
    const input = document.getElementById('messageInput');
    const preview = document.getElementById('previewContent');
    if (input && preview) {
        const text = input.value;
        preview.innerHTML = text.trim() ? renderMarkdown(text) : '';
    }
}

// ============ 轮询 ============
function startPolling() {
    if (S.pollInterval) clearInterval(S.pollInterval);
    S.pollInterval = setInterval(async () => {
        if (S.currentRoom && !S.currentRoom.isBanned) await pollNewMessages();
    }, 3000);
}

// 兼容：loadMessages 现在进入房间即加载全部消息，滚动到顶部不再触发加载更多
