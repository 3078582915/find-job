@echo off
setlocal
chcp 65001 >nul
title Job Agent - Stop

cd /d "%~dp0"
set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3001 .*LISTENING"') do (
  set "FOUND=1"
  taskkill /PID %%P /T /F >nul 2>nul
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING"') do (
  set "FOUND=1"
  taskkill /PID %%P /T /F >nul 2>nul
)

if "%FOUND%"=="0" (
  echo Project services are not running.
  pause
  exit /b 0
)

timeout /t 1 /nobreak >nul
netstat -ano | findstr /R /C:":3001 .*LISTENING" /C:":5173 .*LISTENING" >nul
if errorlevel 1 (
  echo Project services stopped.
) else (
  echo Some project services could not be stopped. Try running this file as administrator.
)
pause
pause
