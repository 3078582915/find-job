@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "TEST_PYTHON=python"
if exist ".venv\Scripts\python.exe" set "TEST_PYTHON=.venv\Scripts\python.exe"
"%TEST_PYTHON%" run_tests.py %*
set "TEST_EXIT=%ERRORLEVEL%"
echo.
echo 测试报告：%~dp0reports\report.html
pause
exit /b %TEST_EXIT%
