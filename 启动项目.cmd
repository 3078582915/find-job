@echo off
setlocal
chcp 65001 >nul
title Job Agent - Quick Start

set "ROOT=%~dp0"
cd /d "%ROOT%"

where node.exe >nul 2>nul
if errorlevel 1 goto NO_NODE
where npm.cmd >nul 2>nul
if errorlevel 1 goto NO_NPM
if not exist "node_modules\concurrently\dist\bin\concurrently.js" goto NO_DEPS
if not exist "client\node_modules\vite\bin\vite.js" goto NO_DEPS
if not exist "server\node_modules\tsx\dist\cli.mjs" goto NO_DEPS
if not exist "server\data" mkdir "server\data" >nul 2>nul

set "SERVER_PID="
set "CLIENT_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3001 .*LISTENING"') do set "SERVER_PID=%%P"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":5173 .*LISTENING"') do set "CLIENT_PID=%%P"

if defined SERVER_PID if defined CLIENT_PID goto ALREADY_RUNNING
if defined SERVER_PID goto SERVER_BUSY
if defined CLIENT_PID goto CLIENT_BUSY

echo Starting client and server...
start "Job Agent Dev Server" /D "%ROOT%" cmd.exe /K "call npm.cmd run dev"
echo Waiting for backend health check...
for /l %%N in (1,1,30) do (
  powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto SERVER_READY
  timeout /t 1 /nobreak >nul
)
goto START_FAILED

:SERVER_READY
echo Backend is ready. Waiting for frontend...
for /l %%N in (1,1,30) do (
  powershell.exe -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:5173/' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto SERVICES_READY
  timeout /t 1 /nobreak >nul
)
goto START_FAILED

:SERVICES_READY
start "" "http://localhost:5173/"
echo Services are ready. The browser has been opened.
exit /b 0

:ALREADY_RUNNING
echo Services are already running.
start "" "http://localhost:5173/"
echo The browser has been opened.
pause
exit /b 0

:SERVER_BUSY
echo Port 3001 is already in use by PID %SERVER_PID%, but the client is not running.
echo Close the process using port 3001, then try again.
pause
exit /b 1

:CLIENT_BUSY
echo Port 5173 is already in use by PID %CLIENT_PID%, but the server is not running.
echo Close the process using port 5173, then try again.
pause
exit /b 1

:NO_NODE
echo Node.js was not found. Install Node.js 20 or newer first.
pause
exit /b 1

:NO_NPM
echo npm was not found. Reinstall Node.js and make sure npm is on PATH.
pause
exit /b 1

:NO_DEPS
echo Dependencies are missing. Run the first setup .cmd file once, then try again.
pause
exit /b 1

:START_FAILED
echo Services did not become ready within 30 seconds.
echo The development window was kept open. Check its output for the exact error.
pause
exit /b 1
