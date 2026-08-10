/* ============================================================
 * 必应每日一图壁纸
 *  - 在应用内作为背景显示（CSS，位于 UI 之下，不影响操作/退出）
 *  - 同时尝试通过 Electron 真实切换系统桌面壁纸（若主进程支持）
 *  - 显示图片标题与版权信息
 * ============================================================ */

const WP_LOCAL_KEY = 'nflshc_wallpaper_enabled';
const WP_AUTO_KEY = 'nflshc_wallpaper_auto';

const BING_BASE = 'https://www.bing.com';

let wpCurrentUrl = '';
let wpCurrentCopyright = '';
let wpCurrentTitle = '';
let wpAutoTimer = null;

/* 获取必应每日一图图片地址（及版权信息） */
async function fetchBingImageUrl(idx) {
  const url = `${BING_BASE}/HPImageArchive.aspx?format=js&idx=${idx}&n=1&mkt=zh-CN`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('必应接口请求失败: ' + res.status);
  const data = await res.json();
  const img = (data.images && data.images[0]) || {};
  const fullUrl = BING_BASE + (img.url || img.urlbase || '');
  wpCurrentCopyright = img.copyright || '';
  wpCurrentTitle = img.title || img.copyright || '必应每日一图';
  return fullUrl;
}

/* 将图片应用到应用内背景层，并显示版权信息 */
function applyWallpaper(url) {
  const layer = document.getElementById('wallpaperLayer');
  if (!layer) return;
  layer.style.backgroundImage = `url("${url}")`;
  document.body.classList.add('wallpaper-on');

  const cap = document.getElementById('wallpaperCaption');
  const t = document.getElementById('wpCaptionTitle');
  const c = document.getElementById('wpCaptionCopyright');
  if (cap && t && c) {
    t.textContent = wpCurrentTitle || '';
    c.textContent = wpCurrentCopyright || '';
    cap.classList.add('show');
  }
}

/* 关闭应用内壁纸 */
function removeWallpaper() {
  const layer = document.getElementById('wallpaperLayer');
  if (layer) layer.style.backgroundImage = '';
  document.body.classList.remove('wallpaper-on');
  const cap = document.getElementById('wallpaperCaption');
  if (cap) cap.classList.remove('show');
}

/* 下载图片到本地临时文件，并返回其本地路径（用于真实切换桌面壁纸） */
async function downloadImageToLocal(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('图片下载失败: ' + res.status);
  const blob = await res.blob();
  const fileName = 'bing_wallpaper_' + Date.now() + '.jpg';
  // 优先使用 Electron 提供的本地保存能力
  if (window.electronAPI && window.electronAPI.saveWallpaperTemp) {
    return await window.electronAPI.saveWallpaperTemp(await blob.arrayBuffer(), fileName);
  }
  // 浏览器环境兜底：用 object URL（仅应用内有效，无法设为桌面壁纸）
  return URL.createObjectURL(blob);
}

/* 设置壁纸总入口：应用内显示 +（若支持）真实切换桌面壁纸 */
async function setWallpaper(url) {
  applyWallpaper(url);
  // 尝试真实切换系统桌面壁纸
  try {
    if (window.electronAPI && window.electronAPI.setWallpaper) {
      const localPath = await downloadImageToLocal(url);
      const ok = await window.electronAPI.setWallpaper(localPath);
      if (ok) {
        toast('已切换桌面壁纸');
      } else {
        toast('已应用应用内壁纸（当前环境不支持切换系统桌面）');
      }
    }
  } catch (e) {
    console.warn('设置真实桌面壁纸失败，仅保留应用内壁纸:', e);
    toast('已应用应用内壁纸');
  }
}

/* 开关壁纸 */
async function setWallpaperEnabled(enabled) {
  localStorage.setItem(WP_LOCAL_KEY, enabled ? '1' : '0');
  const btn = document.getElementById('btnWallpaper');
  if (btn) btn.classList.toggle('active', enabled);
  if (enabled) {
    toast('正在加载每日一图...');
    try {
      const url = await fetchBingImageUrl(0);
      wpCurrentUrl = url;
      await setWallpaper(url);
    } catch (e) {
      toast('壁纸加载失败: ' + e.message);
      console.error(e);
      if (btn) btn.classList.remove('active');
    }
  } else {
    removeWallpaper();
    toast('已关闭壁纸');
  }
}

/* 随机切换一张壁纸（idx 0-7） */
async function changeWallpaperNow() {
  toast('正在切换壁纸...');
  const idx = Math.floor(Math.random() * 8);
  try {
    const url = await fetchBingImageUrl(idx);
    wpCurrentUrl = url;
    await setWallpaper(url);
  } catch (e) {
    toast('切换失败: ' + e.message);
    console.error(e);
  }
}

/* 自动轮播（默认 30 分钟） */
function startWallpaperAuto(enabled) {
  localStorage.setItem(WP_AUTO_KEY, enabled ? '1' : '0');
  if (wpAutoTimer) {
    clearInterval(wpAutoTimer);
    wpAutoTimer = null;
  }
  if (enabled) {
    wpAutoTimer = setInterval(() => {
      changeWallpaperNow();
    }, 30 * 60 * 1000);
  }
}

/* 打开/关闭设置弹窗 */
function openWallpaperSettings() {
  const modal = document.getElementById('wallpaperModal');
  if (!modal) return;
  const enabled = localStorage.getItem(WP_LOCAL_KEY) === '1';
  const auto = localStorage.getItem(WP_AUTO_KEY) === '1';
  const wpToggle = document.getElementById('wpToggle');
  const wpAuto = document.getElementById('wpAuto');
  if (wpToggle) wpToggle.checked = enabled;
  if (wpAuto) wpAuto.checked = auto;
  modal.style.display = 'flex';
}

function closeWallpaperSettings() {
  const modal = document.getElementById('wallpaperModal');
  if (modal) modal.style.display = 'none';
}

function saveWallpaperSettings() {
  const wpToggle = document.getElementById('wpToggle');
  const wpAuto = document.getElementById('wpAuto');
  const enabled = wpToggle ? wpToggle.checked : false;
  const auto = wpAuto ? wpAuto.checked : false;
  startWallpaperAuto(auto);
  setWallpaperEnabled(enabled);
  closeWallpaperSettings();
}

/* 初始化壁纸功能 */
function initWallpaper() {
  const btnWallpaper = document.getElementById('btnWallpaper');
  const btnWallpaperSettings = document.getElementById('btnWallpaperSettings');
  const wpModalClose = document.getElementById('wpModalClose');
  const wpChangeBtn = document.getElementById('wpChangeBtn');

  if (btnWallpaper) {
    btnWallpaper.addEventListener('click', () => {
      const enabled = localStorage.getItem(WP_LOCAL_KEY) === '1';
      setWallpaperEnabled(!enabled);
    });
  }
  if (btnWallpaperSettings) {
    btnWallpaperSettings.addEventListener('click', openWallpaperSettings);
  }
  if (wpModalClose) {
    wpModalClose.addEventListener('click', closeWallpaperSettings);
  }
  if (wpChangeBtn) {
    wpChangeBtn.addEventListener('click', () => {
      changeWallpaperNow();
    });
  }

  // 启动时若开启了壁纸，则自动加载
  const enabled = localStorage.getItem(WP_LOCAL_KEY) === '1';
  if (btnWallpaper) btnWallpaper.classList.toggle('active', enabled);
  if (enabled) {
    setWallpaperEnabled(true);
  }
  // 恢复自动轮播
  if (localStorage.getItem(WP_AUTO_KEY) === '1') {
    startWallpaperAuto(true);
  }
}
