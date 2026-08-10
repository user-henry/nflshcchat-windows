// ============================================================
// github-api.js - 数据层适配器
// 新版后端：Cloudflare Workers + D1（legacy issues 兼容层）
// 通过 CONFIG.API_BASE 指向主项目 Worker
// 废除 GitHub REST API 直连模式（仍使用 GitHub PAT 作为 Worker 鉴权）
// ============================================================

const GITHUB_API = {
    // 兼容旧调用名
    base: CONFIG.API_BASE,

    _authHeader() {
        // 新框架：Worker + D1，公开端点，前端不携带任何令牌
        return {};
    },

    _headers(extra) {
        return Object.assign(
            { 'Accept': 'application/json' },
            this._authHeader(),
            extra || {}
        );
    },

    // legacy issues 端点：一次性返回该 label 全部记录（不分页）
    async getIssues(label, params = {}) {
        let url = `${CONFIG.API_BASE}/api/legacy/issues?labels=${encodeURIComponent(label)}&state=open`;
        Object.entries(params).forEach(([k, v]) => { url += `&${k}=${encodeURIComponent(v)}`; });
        const res = await fetch(url, { headers: this._headers() });
        let data = await res.json().catch(() => []);
        if (!Array.isArray(data)) data = data.data || data.issues || [];
        return { data, linkHeader: null };
    },

    // 兼容旧逻辑：legacy 层已一次性返回全部，这里直接返回
    async getAllIssues(label) {
        const { data } = await this.getIssues(label);
        return { data };
    },

    async getIssue(number) {
        const res = await fetch(`${CONFIG.API_BASE}/api/legacy/issues/${number}`, { headers: this._headers() });
        return res.json();
    },

    async createIssue(title, body, labels) {
        const res = await fetch(`${CONFIG.API_BASE}/api/legacy/issues`, {
            method: 'POST',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ title, body, labels })
        });
        return res.json();
    },

    async updateIssue(issueNumber, body) {
        const res = await fetch(`${CONFIG.API_BASE}/api/legacy/issues/${issueNumber}`, {
            method: 'PATCH',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ body })
        });
        return res.json();
    },

    async closeIssue(issueNumber) {
        const res = await fetch(`${CONFIG.API_BASE}/api/legacy/issues/${issueNumber}`, {
            method: 'PATCH',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ state: 'closed' })
        });
        return res.json();
    }
};

// 从 Issue body 中解析 JSON 数据的辅助函数
function parseJsonFromIssue(issue) {
    if (!issue || !issue.body) return null;
    const match = issue.body.match(/```json\s*\r?\n([\s\S]*?)\r?\n\s*```/);
    if (match) {
        try {
            return JSON.parse(match[1]);
        } catch (e) { /* 继续尝试其他方式 */ }
    }
    try {
        const result = JSON.parse(issue.body);
        if (result && typeof result === 'object') return result;
    } catch (e) { /* 不是纯 JSON */ }
    return null;
}

// 构造 Issue body
function buildIssueBody(type, data) {
    return `${type}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}
