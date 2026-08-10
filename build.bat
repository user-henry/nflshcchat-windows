@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   NFLSHC Chat - 重新打包中...
echo ============================================
echo.
call npx electron-builder --win nsis portable --x64
echo.
echo ============================================
echo   打包完成! 输出目录: dist\
echo ============================================
pause
