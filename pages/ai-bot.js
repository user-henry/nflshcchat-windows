// ============================================================
// ai-bot.js - AI 机器人集成（思知 API）
// ============================================================

async function callAIAPI(msg) {
    try {
        const url = `${BOT_CONFIG.apiUrl}?appid=${BOT_CONFIG.appid}&userid=${encodeURIComponent(S.currentUser.username)}&spoken=${encodeURIComponent(msg)}&memory=true`;
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.status === 0 && data.data && data.data.info && data.data.info.text) {
            return data.data.info.text;
        }
        return null;
    } catch (error) {
        console.error('AI API 请求失败:', error);
        return null;
    }
}

async function sendBotMessage(roomId, content) {
    if (!content || content === '暂无回复') return;
    const botMessage = {
        id: `msg_bot_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        roomId,
        sender: BOT_CONFIG.name,
        content,
        timestamp: new Date().toISOString(),
        isRecalled: false,
        isPinned: false
    };
    await GITHUB_API.createIssue(`Message: ${botMessage.id}`, buildIssueBody('聊天消息', botMessage), ['chatmessage']);
}

async function handlePrivateAIChat(content) {
    const reply = await callAIAPI(content);
    if (reply) {
        await sendBotMessage(S.currentRoom.id, reply);
        await pollNewMessages();
    }
}

async function triggerAIReply(roomId, sender, messageContent) {
    if (!BOT_CONFIG.enabled) return false;
    if (sender === BOT_CONFIG.name) return false;
    if (!S.currentRoom || S.currentRoom.type !== 'group') return false;

    const hasTrigger = BOT_CONFIG.triggerWords.some(word =>
        messageContent.toLowerCase().includes(word.toLowerCase())
    );
    if (!hasTrigger) return false;

    let question = messageContent;
    for (const word of BOT_CONFIG.triggerWords) {
        question = question.replace(new RegExp(word, 'gi'), '');
    }
    question = question.trim() || messageContent;

    // 日程提醒
    const scheduleMatch = question.match(/(?:提醒我|提醒|日程|闹钟|定时)\s*(\d{1,2}):(\d{2})\s+(.{1,50})/);
    if (scheduleMatch) {
        const now = new Date();
        const schedHour = parseInt(scheduleMatch[1]);
        const schedMin = parseInt(scheduleMatch[2]);
        const schedContent = scheduleMatch[3].trim();
        let schedTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), schedHour, schedMin, 0);
        if (schedTime <= now) schedTime.setDate(schedTime.getDate() + 1);
        const delay = schedTime.getTime() - Date.now();
        const replyText = '⏰ 好的！我会在 ' + schedTime.toLocaleString() + ' 提醒你：' + schedContent;
        await sendBotMessage(roomId, replyText);
        setTimeout(async () => {
            await sendBotMessage(roomId, '⏰ 提醒 @' + sender + '：' + schedContent);
            await pollNewMessages();
        }, delay);
        return true;
    }

    const reply = await callAIAPI(question);
    if (reply) {
        await sendBotMessage(roomId, reply);
        await pollNewMessages();
        return true;
    }
    return false;
}
