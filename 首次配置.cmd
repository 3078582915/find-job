@echo off
setlocal
chcp 65001 >nul
title Job Agent - First Setup

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ========================================
echo   Job Agent - First Setup
echo ========================================
echo.

where node.exe >nul 2>nul
if errorlevel 1 goto NO_NODE
where npm.cmd >nul 2>nul
if errorlevel 1 goto NO_NPM

for /f "tokens=1 delims=v." %%V in ('node.exe --version 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto BAD_NODE
if %NODE_MAJOR% LSS 20 goto OLD_NODE

echo Node.js version check passed.
if not exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" echo WARNING: Google Chrome was not found. Browser crawling needs Chrome.
if not exist "server\data" mkdir "server\data" >nul 2>nul
if not exist "server\.env" copy /Y "server\.env.example" "server\.env" >nul

echo.
echo [1/4] Installing root dependencies...
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto INSTALL_FAILED

echo.
echo [2/4] Installing client dependencies...
pushd client
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 (
  popd
  goto INSTALL_FAILED
)
popd

echo.
echo [3/4] Installing server dependencies...
pushd server
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 (
  popd
  goto INSTALL_FAILED
)
popd

echo.
echo [4/4] Checking the project build...
call npm.cmd run build
if errorlevel 1 goto BUILD_FAILED

echo.
echo Setup completed successfully.
echo Next time, double-click the project start .cmd file in this folder.
pause
exit /b 0

:NO_NODE
echo Node.js was not found. Install Node.js 20 or newer, then run this file again.
pause
exit /b 1

:NO_NPM
echo npm was not found. Reinstall Node.js and make sure npm is on PATH.
pause
exit /b 1

:BAD_NODE
echo Could not read the Node.js version.
pause
exit /b 1

:OLD_NODE
echo Node.js 20 or newer is required. Current major version: %NODE_MAJOR%
pause
exit /b 1

:INSTALL_FAILED
echo Dependency installation failed. Check the network and npm output above.
pause
exit /b 1

:BUILD_FAILED
echo The project build failed. Check the compiler output above.
pause
exit /b 1
