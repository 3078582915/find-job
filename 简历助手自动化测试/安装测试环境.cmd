@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
python -m venv .venv
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m playwright install chromium
if errorlevel 1 goto failed
echo 测试环境安装完成，可以运行“一键测试.cmd”。
pause
exit /b 0
:failed
echo 安装失败，请查看上方错误信息。
pause
exit /b 1
