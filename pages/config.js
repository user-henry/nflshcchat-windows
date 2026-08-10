// NFLSHC Chat - 配置文件
// 新版后端：Cloudflare Workers + D1（废除 GitHub Issues 直连）
// 前端无需任何 Token —— 数据读写由 Worker 服务端对接 D1 完成
window.CONFIG = {
  // 主项目 Worker（legacy issues 兼容层，公开端点，无需鉴权）
  API_BASE: 'https://worker.nflshcchat.cc.cd'
};

// EmailJS 配置（用于注册/找回密码验证码）
window.EMAILJS_CONFIG = {
  publicKey: 'A-3y5AHO_oj3PQU5l',
  serviceId: 'service_6iugtla',
  templateId: 'template_03vba8b'
};

// AI 机器人配置（与 web 版 chat.html 保持一致）
window.BOT_CONFIG = {
  enabled: true,
  name: '🤖 AI小助手',
  apiUrl: 'https://api.sizhi.com/chat',
  appid: 'd18408ec60b14c5f844d5004881808eb',
  triggerWords: ['@AI', '@机器人', 'AI', '机器人']
};

// 站点 Logo
window.SITE_LOGO = '../assets/icon.png';
