const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectDir = path.join(__dirname);
const distDir = path.join(projectDir, 'dist');
const tempDir = path.join('C:', 'nflshc_temp');

// 确保临时目录存在
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

console.log('项目目录:', projectDir);
console.log('临时目录:', tempDir);
console.log('构建目录:', distDir);

// 清理旧的构建产物
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 构建便携版
console.log('\n=== 打包便携版 ===');
try {
    execSync(`node "node_modules/electron-builder/out/cli/cli.js" --win portable --x64`, {
        cwd: projectDir,
        stdio: 'inherit',
        env: { ...process.env, TMPDIR: tempDir, TEMP: tempDir, TMP: tempDir }
    });
    console.log('便携版构建成功');
} catch (e) {
    console.error('便携版构建失败:', e.message);
}

// 构建安装版
console.log('\n=== 打包安装版 ===');
try {
    execSync(`node "node_modules/electron-builder/out/cli/cli.js" --win nsis --x64`, {
        cwd: projectDir,
        stdio: 'inherit',
        env: { ...process.env, TMPDIR: tempDir, TEMP: tempDir, TMP: tempDir }
    });
    console.log('安装版构建成功');
} catch (e) {
    console.error('安装版构建失败:', e.message);
}

// 移动构建产物到 dist 目录
console.log('\n=== 整理构建产物 ===');
const buildDir = path.join(projectDir, 'build');
if (fs.existsSync(buildDir)) {
    const files = fs.readdirSync(buildDir);
    files.forEach(file => {
        const src = path.join(buildDir, file);
        const dest = path.join(distDir, file);
        fs.copyFileSync(src, dest);
        console.log(`  移动: ${file}`);
    });
    fs.rmSync(buildDir, { recursive: true, force: true });
}

console.log('\n=== 构建完成 ===');
console.log('产物目录:', distDir);
const distFiles = fs.readdirSync(distDir);
distFiles.forEach(f => {
    const stats = fs.statSync(path.join(distDir, f));
    console.log(`  ${f} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
});
