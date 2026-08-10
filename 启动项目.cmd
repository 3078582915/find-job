@echo off
setlocal
chcp 65001 >nul
title Job Agent - Quick Start

cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 goto NO_NODE
if not exist "node_modules\concurrently\dist\bin\concurrently.js" goto NO_DEPS

set "SERVER_PID="
set "CLIENT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3001 .*LISTENING"') do set "SERVER_PID=%%P"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING"') do set "CLIENT_PID=%%P"

if defined SERVER_PID if defined CLIENT_PID goto ALREADY_RUNNING
if defined SERVER_PID goto SERVER_BUSY
if defined CLIENT_PID goto CLIENT_BUSY

set "NODE_OPTIONS=--use-env-proxy"
echo Starting client and server...
start "Job Agent Dev Server" /D "%~dp0" cmd.exe /K "call npm.cmd run dev"
echo Waiting for services...
timeout /t 5 /nobreak >nul
echo Services started. Open http://localhost:5173/ in your browser.
exit /b 0

:ALREADY_RUNNING
echo Services are already running.
echo Open http://localhost:5173/ in your browser.
pause
exit /b 0

:SERVER_BUSY
echo Port 3001 is already in use, but the client is not running.
echo Close the process using port 3001, then try again.
pause
exit /b 1

:CLIENT_BUSY
echo Port 5173 is already in use, but the server is not running.
echo Close the process using port 5173, then try again.
pause
exit /b 1

:NO_NODE
echo Node.js was not found. Install Node.js 20 or newer first.
pause
exit /b 1

:NO_DEPS
echo Dependencies are missing. Run npm install in the project folder first.
pause
exit /b 1
