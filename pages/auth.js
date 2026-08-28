// ============================================================
// auth.js - 登录 / 注册 / 忘记密码 / 会话管理（SHA-256 + 邮箱验证码）
// ============================================================

const STORAGE_KEY = 'nflshc_currentUser';

// 内存中的验证码缓存（按邮箱）
const verificationCodeStore = new Map();

// ============ SHA-256 密码哈希 ============
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(inputPassword, storedUser) {
    if (storedUser.passwordHashed) {
        const hashed = await hashPassword(inputPassword);
        return hashed === storedUser.password;
    }
    // 兼容旧版本明文密码
    return inputPassword === storedUser.password;
}

// ============ 会话管理 ============
function saveLoginState(user) {
    const userStr = JSON.stringify(user);
    localStorage.setItem(STORAGE_KEY, userStr);
    if (window.electronAPI && window.electronAPI.isElectron) {
        window.electronAPI.saveLocalData('currentUser.json', user);
    }
}

function clearLoginState() {
    localStorage.removeItem(STORAGE_KEY);
    if (window.electronAPI && window.electronAPI.isElectron) {
        window.electronAPI.deleteLocalData('currentUser.json');
    }
}

async function checkTokenValid() {
    const token = getToken();
    if (!token) return false;
    try {
        const result = await GITHUB_API.getMe();
        return result.valid !== false && result.username;
    } catch (e) {
        return false;
    }
}

async function checkAutoLogin() {
    const token = getToken();
    if (!token) {
        // 无 token，检查本地缓存的用户信息
        let userStr = localStorage.getItem(STORAGE_KEY);
        if (!userStr && window.electronAPI && window.electronAPI.isElectron) {
            const result = await window.electronAPI.loadLocalData('currentUser.json');
            if (result.success && result.data) {
                userStr = JSON.stringify(result.data);
                localStorage.setItem(STORAGE_KEY, userStr);
            }
        }
        if (userStr) {
            try {
                const user = JSON.parse(userStr);
                if (user && user.username) {
                    S.currentUser = user;
                    showChatPage();
                    await initChat();
                    return true;
                }
            } catch (e) { }
        }
        return false;
    }
    // 有 token，验证有效性
    const valid = await checkTokenValid();
    if (!valid) {
        clearToken();
        clearLoginState();
        return false;
    }
    // token 有效，恢复用户会话
    let userStr = localStorage.getItem(STORAGE_KEY);
    if (!userStr && window.electronAPI && window.electronAPI.isElectron) {
        const result = await window.electronAPI.loadLocalData('currentUser.json');
        if (result.success && result.data) {
            userStr = JSON.stringify(result.data);
            localStorage.setItem(STORAGE_KEY, userStr);
        }
    }
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            if (user && user.username) {
                S.currentUser = user;
                showChatPage();
                await initChat();
                return true;
            }
        } catch (e) { }
    }
    return false;
}

// ============ 登录 ============
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const msgDiv = document.getElementById('loginMessage');

    if (!username || !password) {
        msgDiv.innerHTML = '<span class="error">请填写用户名和密码</span>';
        return;
    }

    msgDiv.innerHTML = '<span class="info">正在登录...</span>';

    try {
        const result = await GITHUB_API.login(username, password);
        if (result.token) {
            const userData = {
                username: result.username,
                isAdmin: result.isAdmin || false,
                email: '',
                avatarUrl: '',
                bio: '',
                createdAt: new Date().toISOString()
            };
            S.currentUser = userData;
            saveLoginState(userData);
            msgDiv.innerHTML = '<span class="success">登录成功，正在跳转...</span>';
            setTimeout(() => { showChatPage(); initChat(); }, 800);
        } else {
            msgDiv.innerHTML = '<span class="error">用户名或密码错误</span>';
        }
    } catch (error) {
        msgDiv.innerHTML = `<span class="error">登录失败: ${error.message}</span>`;
    }
}

// ============ 退出登录 ============
async function logout() {
    if (S.pollInterval) clearInterval(S.pollInterval);
    stopNotifPolling();
    try {
        await GITHUB_API.logout();
    } catch (e) { /* ignore */ }
    clearLoginState();
    S.currentUser = null;
    S.currentRoom = null;
    S.allRooms = [];
    S.allMessages = [];
    showLoginPage();
    showToast('已退出登录', 'info');
}

// ============ 邮箱验证码 ============
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code) {
    if (typeof emailjs === 'undefined') {
        throw new Error('邮件服务不可用');
    }
    emailjs.init(window.EMAILJS_CONFIG.publicKey);
    return emailjs.send(
        window.EMAILJS_CONFIG.serviceId,
        window.EMAILJS_CONFIG.templateId,
        { to_email: email, verification_code: code }
    );
}

function getCountdownKey(btnId) {
    return 'nflshc_' + btnId + '_until';
}

function startCountdown(btnId, seconds = 60) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = true;
    let left = seconds;
    const originalText = btn.textContent;
    btn.textContent = `${left}s`;
    const timer = setInterval(() => {
        left--;
        if (left <= 0) {
            clearInterval(timer);
            btn.disabled = false;
            btn.textContent = originalText;
        } else {
            btn.textContent = `${left}s`;
        }
    }, 1000);
}

// ============ 注册 ============
async function sendRegisterVerificationCode() {
    const email = document.getElementById('regEmail').value.trim();
    const msgDiv = document.getElementById('registerMessage');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msgDiv.innerHTML = '<span class="error">请输入有效的邮箱地址</span>';
        return;
    }

    msgDiv.innerHTML = '<span class="info">正在发送验证码...</span>';
    try {
        const code = generateVerificationCode();
        verificationCodeStore.set(email, { code, timestamp: Date.now() });
        await sendVerificationEmail(email, code);
        startCountdown('btnSendRegCode', 60);
        msgDiv.innerHTML = '<span class="success">验证码已发送，请查收邮箱</span>';
    } catch (error) {
        msgDiv.innerHTML = `<span class="error">发送失败: ${error.message}</span>`;
    }
}

async function register() {
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;
    const email = document.getElementById('regEmail').value.trim();
    const verifyCode = document.getElementById('regVerifyCode').value.trim();
    const msgDiv = document.getElementById('registerMessage');

    if (!username || !password || !passwordConfirm || !email || !verifyCode) {
        msgDiv.innerHTML = '<span class="error">请填写所有字段</span>';
        return;
    }
    if (username.length < 3 || username.length > 20) {
        msgDiv.innerHTML = '<span class="error">用户名长度需为3-20个字符</span>';
        return;
    }
    if (password.length < 6) {
        msgDiv.innerHTML = '<span class="error">密码至少需要6位</span>';
        return;
    }
    if (password !== passwordConfirm) {
        msgDiv.innerHTML = '<span class="error">两次输入的密码不一致</span>';
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msgDiv.innerHTML = '<span class="error">请输入有效的邮箱地址</span>';
        return;
    }

    const stored = verificationCodeStore.get(email);
    if (!stored || stored.code !== verifyCode) {
        msgDiv.innerHTML = '<span class="error">验证码错误或已过期</span>';
        return;
    }
    if (Date.now() - stored.timestamp > 10 * 60 * 1000) {
        msgDiv.innerHTML = '<span class="error">验证码已过期，请重新获取</span>';
        return;
    }

    msgDiv.innerHTML = '<span class="info">正在注册...</span>';

    try {
        await GITHUB_API.register(username, password, email, '');
        msgDiv.innerHTML = '<span class="success">注册成功！正在跳转...</span>';
        document.getElementById('regVerifyCode').value = '';
        verificationCodeStore.delete(email);
        setTimeout(() => showLoginPage(), 1000);
    } catch (error) {
        msgDiv.innerHTML = `<span class="error">注册失败: ${error.message}</span>`;
    }
}

// ============ 忘记密码 ============
function showForgotPassword() {
    document.getElementById('forgotModal').classList.add('show');
    document.getElementById('forgotUsername').value = '';
    document.getElementById('forgotEmail').value = '';
    document.getElementById('forgotVerifyCode').value = '';
    document.getElementById('forgotNewPassword').value = '';
    document.getElementById('forgotConfirmPassword').value = '';
    document.getElementById('forgotMessage').innerHTML = '';
}

function closeForgotModal() {
    document.getElementById('forgotModal').classList.remove('show');
}

async function sendForgotVerificationCode() {
    const username = document.getElementById('forgotUsername').value.trim();
    const email = document.getElementById('forgotEmail').value.trim();
    const msgDiv = document.getElementById('forgotMessage');

    if (!username || !email) {
        msgDiv.innerHTML = '<span class="error">请填写用户名和邮箱</span>';
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msgDiv.innerHTML = '<span class="error">请输入有效的邮箱地址</span>';
        return;
    }

    msgDiv.innerHTML = '<span class="info">正在发送验证码...</span>';
    try {
        const result = await GITHUB_API.forgotPassword(username, email);
        if (result.success || result.message) {
            const code = generateVerificationCode();
            verificationCodeStore.set(email, { code, timestamp: Date.now() });
            await sendVerificationEmail(email, code);
            startCountdown('btnSendForgotCode', 60);
            msgDiv.innerHTML = '<span class="success">验证码已发送，请查收邮箱</span>';
        } else {
            msgDiv.innerHTML = '<span class="error">' + (result.message || '发送失败') + '</span>';
        }
    } catch (error) {
        msgDiv.innerHTML = `<span class="error">发送失败: ${error.message}</span>`;
    }
}

async function resetPasswordWithCode() {
    const username = document.getElementById('forgotUsername').value.trim();
    const email = document.getElementById('forgotEmail').value.trim();
    const verifyCode = document.getElementById('forgotVerifyCode').value.trim();
    const newPassword = document.getElementById('forgotNewPassword').value;
    const confirmPassword = document.getElementById('forgotConfirmPassword').value;
    const msgDiv = document.getElementById('forgotMessage');

    if (!username || !email || !verifyCode || !newPassword || !confirmPassword) {
        msgDiv.innerHTML = '<span class="error">请填写所有字段</span>';
        return;
    }
    if (newPassword.length < 6) {
        msgDiv.innerHTML = '<span class="error">新密码至少6位</span>';
        return;
    }
    if (newPassword !== confirmPassword) {
        msgDiv.innerHTML = '<span class="error">两次输入的密码不一致</span>';
        return;
    }

    const stored = verificationCodeStore.get(email);
    if (!stored || stored.code !== verifyCode) {
        msgDiv.innerHTML = '<span class="error">验证码错误或已过期</span>';
        return;
    }
    if (Date.now() - stored.timestamp > 10 * 60 * 1000) {
        msgDiv.innerHTML = '<span class="error">验证码已过期，请重新获取</span>';
        return;
    }

    msgDiv.innerHTML = '<span class="info">正在验证并重置密码...</span>';
    try {
        // 先验证验证码
        const verifyResult = await GITHUB_API.verifyResetCode(username, verifyCode);
        if (!verifyResult.success) {
            msgDiv.innerHTML = '<span class="error">验证码验证失败</span>';
            return;
        }
        // 直接沿用 nflshcchat/index.html 的密码重置逻辑
        const hashedPassword = await hashPassword(newPassword);
        const resetPayload = {
            username: username,
            password: hashedPassword,
            passwordHashed: true
        };
        const updatedBody = `用户信息\n\`\`\`json\n${JSON.stringify(resetPayload, null, 2)}\n\`\`\``;
        const patchRes = await fetch(`${CONFIG.API_BASE}/api/legacy/issues/${encodeURIComponent(username)}?labels=user`, {
            method: 'PATCH',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                ...GITHUB_API._headers()
            },
            body: JSON.stringify({ body: updatedBody })
        });
        if (!patchRes.ok) {
            const j = await patchRes.json().catch(() => ({}));
            msgDiv.innerHTML = `<span class="error">重置失败：${j.error || ('HTTP ' + patchRes.status)}</span>`;
            return;
        }
        verificationCodeStore.delete(email);
        msgDiv.innerHTML = '<span class="success">密码重置成功！正在跳转到登录页...</span>';
        setTimeout(() => closeForgotModal(), 2000);
    } catch (error) {
        msgDiv.innerHTML = `<span class="error">重置失败: ${error.message}</span>`;
    }
}

// ============ 辅助：用户查询 ============
async function checkUserBanned(username) {
    if (isSystemAdmin(username) || username === BOT_CONFIG.name) return false;
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        for (const issue of issues) {
            const userData = parseJsonFromIssue(issue);
            if (userData && userData.username === username) return userData.isBanned || false;
        }
        return false;
    } catch (e) { return false; }
}

async function checkUserExists(username) {
    if (isSystemAdmin(username) || username === BOT_CONFIG.name) return true;
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        for (const issue of issues) {
            const userData = parseJsonFromIssue(issue);
            if (userData && userData.username === username) return true;
        }
        return false;
    } catch (e) { return false; }
}

async function findUserByName(username) {
    if (!username) return null;
    if (isSystemAdmin(username)) {
        return { username, isAdmin: true, bio: '系统管理员', avatarUrl: '', xp: 99999, createdAt: '2023-01-01' };
    }
    if (username === BOT_CONFIG.name) {
        return { username: BOT_CONFIG.name, bio: 'AI 聊天助手', avatarUrl: '', xp: 0, createdAt: '2024-01-01' };
    }
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        for (const issue of issues) {
            const userData = parseJsonFromIssue(issue);
            if (userData && userData.username === username) {
                return { ...userData, issueNumber: issue.number };
            }
        }
        return null;
    } catch (e) { return null; }
}

async function loadUserProfile() {
    return findUserByName(S.currentUser?.username);
}

async function loadUserAvatars(usernames) {
    const toLoad = usernames.filter(u => !S.userAvatarCache[u]);
    if (toLoad.length === 0) return;

    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        toLoad.forEach(username => {
            const issue = issues.find(i => {
                const ud = parseJsonFromIssue(i);
                return ud && ud.username === username;
            });
            if (issue) {
                const ud = parseJsonFromIssue(issue);
                if (ud && ud.avatarUrl) S.userAvatarCache[username] = ud.avatarUrl;
            }
        });
    } catch (e) { console.error('加载头像失败:', e); }
}

async function loadGlobalMsgCounts() {
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('chatmessage');
        for (const issue of issues) {
            const msgData = parseJsonFromIssue(issue);
            if (msgData && !msgData.isRecalled) {
                S.globalMsgCounts[msgData.sender] = (S.globalMsgCounts[msgData.sender] || 0) + 1;
            }
        }
    } catch (e) { console.error('加载全局消息计数失败:', e); }
}
