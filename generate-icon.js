// 简易图标生成脚本 - 生成一个 256x256 PNG 作为临时图标
// 使用 Canvas API 需要 node-canvas, 这里用更简单的方式: 生成 SVG 再转

const fs = require('fs');
const path = require('path');

// 创建一个简单的 SVG 图标
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="48" fill="url(#bg)"/>
  <circle cx="128" cy="100" r="30" fill="#ffd700"/>
  <rect x="98" y="130" width="60" height="80" rx="30" fill="#ffd700"/>
  <circle cx="128" cy="90" r="24" fill="#1a1a2e"/>
  <text x="128" y="210" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="bold" fill="#ffd700">NFLSHC</text>
</svg>`;

const outputPath = path.join(__dirname, 'assets', 'icon.svg');
fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
fs.writeFileSync(outputPath, svg);
console.log('SVG icon created at:', outputPath);
console.log('Note: For .ico, please convert using an online tool or use the PNG approach.');
console.log('electron-builder will use a PNG if .ico is not available on some platforms.');
