// ============================================================
// github-api.js - 数据层适配器
// 新版后端：Cloudflare Workers + D1（legacy issues 兼容层）
// 通过 CONFIG.API_BASE 指向主项目 Worker
// 废除 GitHub REST API 直连模式（仍使用 GitHub PAT 作为 Worker 鉴权）
// ============================================================

// ============ Token 管理 ============
function getToken() {
    return localStorage.getItem('nflshc_token') || '';
}

function setToken(token) {
    if (token) {
        localStorage.setItem('nflshc_token', token);
    } else {
        localStorage.removeItem('nflshc_token');
    }
}

function clearToken() {
    localStorage.removeItem('nflshc_token');
}

const GITHUB_API = {
    // 兼容旧调用名
    base: CONFIG.API_BASE,

    _authHeader() {
        const token = getToken();
        return token ? { 'Authorization': `Bearer ${token}` } : {};
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
    },

    // 认证相关
    async login(username, password) {
        const hashed = await hashPassword(password);
        const res = await fetch(`${CONFIG.API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: hashed })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || err.message || '登录失败');
        }
        const data = await res.json();
        setToken(data.token);
        return {
            token: data.token,
            username: data.username,
            isAdmin: data.isAdmin
        };
    },

    // 注册：走 legacy users 端点（匿名创建新用户，与 web 版 register.html 一致，
    // 服务端有"用户名已存在 409 / IP 被封禁 403"防护，注册无需邮箱验证码）
    async register(username, password, email, bio) {
        const hashed = await hashPassword(password);
        const userData = {
            username,
            email,
            password: hashed,
            passwordHashed: true,
            bio: bio || '',
            createdAt: new Date().toISOString(),
            isBanned: false,
            avatar: 'https://cdn.luogu.com.cn/upload/image_hosting/5rdb3c08.png'
        };
        const body = buildIssueBody('用户信息', userData);
        const res = await fetch(`${CONFIG.API_BASE}/api/legacy/issues`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, this._authHeader()),
            body: JSON.stringify({ title: `User: ${username}`, body, labels: ['user'] })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) throw new Error('用户名已存在');
        if (res.status === 403) throw new Error(data.error || '您的 IP 已被封禁，请联系管理员');
        if (!res.ok) throw new Error(data.error || data.message || ('注册失败 (HTTP ' + res.status + ')'));
        return data;
    },

    async forgotPassword(username, email) {
        const res = await fetch(`${CONFIG.API_BASE}/api/auth/forgot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });
        return res.json();
    },

    async verifyResetCode(username, code) {
        const res = await fetch(`${CONFIG.API_BASE}/api/auth/verify-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, code })
        });
        return res.json();
    },

    async getMe() {
        const res = await fetch(`${CONFIG.API_BASE}/api/auth/me`, {
            headers: this._headers()
        });
        if (res.status === 401) return { valid: false };
        return res.json();
    },

    async logout() {
        try {
            await fetch(`${CONFIG.API_BASE}/api/auth/logout`, {
                method: 'POST',
                headers: this._headers()
            });
        } catch (e) { /* ignore */ }
        clearToken();
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
