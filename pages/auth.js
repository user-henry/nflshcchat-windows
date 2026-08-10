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

async function checkAutoLogin() {
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

    // 管理员特判
    if (username === 'huangzhiyuan' && password === '15240254891') {
        const userData = { username, isAdmin: true };
        S.currentUser = userData;
        saveLoginState(userData);
        msgDiv.innerHTML = '<span class="success">管理员登录成功，正在跳转...</span>';
        setTimeout(() => { showChatPage(); initChat(); }, 800);
        return;
    }

    msgDiv.innerHTML = '<span class="info">正在登录...</span>';

    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        let foundUser = null;
        let issueNumber = null;
        for (const issue of issues) {
            const userData = parseJsonFromIssue(issue);
            if (userData && userData.username === username) {
                if (await verifyPassword(password, userData)) {
                    foundUser = { ...userData };
                    issueNumber = issue.number;
                }
                break;
            }
        }

        if (foundUser) {
            if (foundUser.isBanned) {
                msgDiv.innerHTML = '<span class="error">账号已被封禁，请联系管理员</span>';
                return;
            }
            const userData = {
                username,
                isAdmin: false,
                email: foundUser.email,
                avatarUrl: foundUser.avatarUrl || '',
                bio: foundUser.bio || '',
                issueNumber,
                createdAt: foundUser.createdAt
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
function logout() {
    if (S.pollInterval) clearInterval(S.pollInterval);
    stopNotifPolling();
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
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        for (const issue of issues) {
            const userData = parseJsonFromIssue(issue);
            if (userData && userData.username === username) {
                msgDiv.innerHTML = '<span class="error">用户名已被注册</span>';
                return;
            }
            if (userData && userData.email === email) {
                msgDiv.innerHTML = '<span class="error">该邮箱已被注册</span>';
                return;
            }
        }

        const hashedPassword = await hashPassword(password);
        const userData = {
            username,
            email,
            password: hashedPassword,
            passwordHashed: true,
            bio: '',
            avatarUrl: '',
            xp: 0,
            level: 1,
            isBanned: false,
            createdAt: new Date().toISOString()
        };

        const issueBody = buildIssueBody('用户信息', userData);
        await GITHUB_API.createIssue(`User: ${username}`, issueBody, ['user']);

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

    msgDiv.innerHTML = '<span class="info">正在验证并发送验证码...</span>';
    try {
        const { data: issues } = await GITHUB_API.getAllIssues('user');
        let foundUser = null;
        let issueNumber = null;
        for (const issue of issues) {
            const userData = parseJsonFromIssue(issue);
            if (userData && userData.username === username) {
                if (userData.email === email) {
                    foundUser = userData;
                    issueNumber = issue.number;
                }
                break;
            }
        }

        if (!foundUser) {
            msgDiv.innerHTML = '<span class="error">用户名或邮箱不匹配</span>';
            return;
        }

        const code = generateVerificationCode();
        verificationCodeStore.set(email, { code, timestamp: Date.now(), issueNumber });
        await sendVerificationEmail(email, code);
        startCountdown('btnSendForgotCode', 60);
        msgDiv.innerHTML = '<span class="success">验证码已发送，请查收邮箱</span>';
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
    if (!stored.issueNumber) {
        msgDiv.innerHTML = '<span class="error">无法找到对应用户，请重新获取验证码</span>';
        return;
    }

    msgDiv.innerHTML = '<span class="info">正在重置密码...</span>';
    try {
        const issue = await GITHUB_API.getIssue(stored.issueNumber);
        const userData = parseJsonFromIssue(issue);
        if (!userData || userData.username !== username) {
            msgDiv.innerHTML = '<span class="error">用户信息异常</span>';
            return;
        }

        userData.password = await hashPassword(newPassword);
        userData.passwordHashed = true;
        const issueBody = buildIssueBody('用户信息', userData);
        await GITHUB_API.updateIssue(stored.issueNumber, issueBody);

        verificationCodeStore.delete(email);
        msgDiv.innerHTML = '<span class="success">密码重置成功，请用新密码登录</span>';
        setTimeout(() => closeForgotModal(), 1500);
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
