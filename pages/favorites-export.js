// ============================================================
// favorites-export.js - 收藏管理 & 数据导出
// ============================================================

// ============ 收藏管理 ============
async function showFavorites() {
    showModal(
        '⭐ 我的收藏',
        '<div class="loading-text">加载中...</div>',
        '<button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>'
    );

    try {
        const { data: allFavIssues } = await GITHUB_API.getAllIssues('favorite');

        const favorites = allFavIssues.map(i => {
            const fav = parseJsonFromIssue(i);
            return fav ? { ...fav, issueNumber: i.number } : null;
        }).filter(f => f && f.userName === S.currentUser.username)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        let contentHtml;
        if (favorites.length === 0) {
            contentHtml = '<p style="color:var(--text-muted);text-align:center;padding:20px;">暂无收藏</p>';
        } else {
            contentHtml = favorites.map(f => `
                <div style="padding:10px 6px;border-bottom:1px solid var(--border-light);">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(f.sender)} · ${formatTime(f.createdAt)}</div>
                            <div style="color:var(--text-primary);font-size:13px;margin-top:4px;word-break:break-word;">${escapeHtml(f.content).substring(0, 200)}</div>
                        </div>
                        <button onclick="deleteFavorite(${f.issueNumber})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:14px;flex-shrink:0;padding:4px 8px;" title="取消收藏">🗑</button>
                    </div>
                </div>`).join('');
        }

        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">⭐ 我的收藏</h3>
            <div style="max-height:350px;overflow-y:auto;">${contentHtml}</div>
            <div class="modal-actions">
                <button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button>
                ${favorites.length > 0 ? `<button class="fluent-btn accent-btn" onclick="exportFavorites('${encodeURIComponent(JSON.stringify(favorites))}')">导出</button>` : ''}
            </div>`;
    } catch (e) {
        document.getElementById('genericModalContent').innerHTML = `
            <h3 class="modal-title">⭐ 我的收藏</h3>
            <p style="color:var(--danger);">加载失败</p>
            <div class="modal-actions"><button class="fluent-btn secondary-btn" onclick="closeModal()">关闭</button></div>`;
    }
}

async function deleteFavorite(issueNumber) {
    if (!confirm('确定要取消收藏吗？')) return;
    try {
        await GITHUB_API.closeIssue(issueNumber);
        showToast('已取消收藏', 'success');
        closeModal();
        showFavorites();
    } catch (e) { showToast('操作失败: ' + e.message, 'error'); }
}

function exportFavorites(encodedFavs) {
    const favorites = JSON.parse(decodeURIComponent(encodedFavs));
    let content = 'NFLSHC Chat - 收藏消息导出\n';
    content += '导出时间: ' + new Date().toLocaleString() + '\n';
    content += '用户: ' + S.currentUser.username + '\n';
    content += '='.repeat(50) + '\n\n';
    favorites.forEach((f, i) => {
        content += `[${i + 1}] ${f.sender} (${new Date(f.createdAt).toLocaleString()})\n`;
        content += f.content + '\n';
        content += '-'.repeat(40) + '\n\n';
    });

    downloadTextFile(content, 'nflshc-favorites-' + Date.now() + '.txt');
    showToast('收藏导出成功！', 'success');
}

// ============ 数据导出 ============
function showExport() {
    showModal(
        '📤 导出聊天数据',
        `<p style="color:var(--text-secondary);margin-bottom:12px;">将当前聊天室的消息导出为文件</p>
         <div style="margin-top:8px;">
             <select id="exportFormat" style="width:100%;padding:10px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:8px;color:var(--text-primary);">
                 <option value="json">JSON 格式</option>
                 <option value="html">HTML 格式</option>
                 <option value="txt">文本格式</option>
             </select>
         </div>`,
        `<button class="fluent-btn secondary-btn" onclick="closeModal()">取消</button>
         <button class="fluent-btn accent-btn" onclick="exportData()">导出</button>`
    );
}

async function exportData() {
    if (!S.currentRoom || S.allMessages.length === 0) {
        showToast('没有可导出的消息', 'error');
        return;
    }

    const format = document.getElementById('exportFormat').value;
    let content, filename, mimeType;

    if (format === 'json') {
        content = JSON.stringify({
            room: { id: S.currentRoom.id, name: S.currentRoom.name, type: S.currentRoom.type },
            messages: S.allMessages.map(m => ({ sender: m.sender, content: m.content, timestamp: m.timestamp })),
            exportedAt: new Date().toISOString()
        }, null, 2);
        filename = `nflshc-${S.currentRoom.name}-${Date.now()}.json`;
        mimeType = 'application/json';
    } else if (format === 'html') {
        content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NFLSHC Chat - ${escapeHtml(S.currentRoom.name)}</title>
<style>body{font-family:'Segoe UI','Microsoft YaHei',sans-serif;background:#1a1a2e;color:#e0e0e0;padding:20px;max-width:800px;margin:0 auto;}
.msg{padding:10px 14px;margin:4px 0;border-radius:10px;background:#16213e;}
.own{background:#ffd700;color:#1a1a2e;}
.time{font-size:11px;opacity:0.6;}h1{color:#ffd700;}</style></head><body>
<h1>📋 ${escapeHtml(S.currentRoom.name)}</h1><p>导出时间: ${new Date().toLocaleString()} | 用户: ${escapeHtml(S.currentUser.username)}</p><hr>
${S.allMessages.map(m => `<div class="msg${m.sender === S.currentUser.username ? ' own' : ''}"><strong>${escapeHtml(m.sender)}</strong>: ${escapeHtml(m.content)}<div class="time">${new Date(m.timestamp).toLocaleString()}</div></div>`).join('')}
</body></html>`;
        filename = `nflshc-${S.currentRoom.name}-${Date.now()}.html`;
        mimeType = 'text/html';
    } else {
        content = `NFLSHC Chat - ${S.currentRoom.name}\n导出时间: ${new Date().toLocaleString()}\n用户: ${S.currentUser.username}\n${'='.repeat(50)}\n\n`
            + S.allMessages.map(m => `[${new Date(m.timestamp).toLocaleString()}] ${m.sender}: ${m.content}`).join('\n\n');
        filename = `nflshc-${S.currentRoom.name}-${Date.now()}.txt`;
        mimeType = 'text/plain';
    }

    if (window.electronAPI && window.electronAPI.isElectron) {
        const result = await window.electronAPI.exportData({ format, content });
        if (result.success) showToast('导出成功！文件已保存', 'success');
        else if (!result.canceled) showToast('导出失败', 'error');
    } else {
        downloadTextFile(content, filename);
        showToast('导出成功！', 'success');
    }
    closeModal();
}

function downloadTextFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
