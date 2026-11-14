@echo off
setlocal enabledelayedexpansion
title SceneFlow Studio Server

echo ========================================================
echo   SceneFlow 1-Click Studio Launcher
echo ========================================================
echo.

:: Switch to script directory
cd /d "%~dp0"

:: If launched from parent directory, switch into frame-maker
if exist "frame-maker\server.js" (
    cd /d "%~dp0frame-maker"
)

:: 1. Verify Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [NOTICE] Node.js is required to run SceneFlow Studio.
    echo Opening official Node.js download page in your browser...
    start https://nodejs.org/en/download
    echo.
    echo Please install the recommended Node.js LTS version,
    echo then double-click Start_SceneFlow.cmd again.
    echo.
    pause
    exit /b 1
)

:: 2. Verify dependencies
if not exist "node_modules" (
    echo [1/3] Installing dependencies...
    call npm.cmd install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] npm install encountered an error.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies verified.
)

:: 3. Free port 3000 if previously occupied
echo [2/3] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Freeing port 3000 - PID %%a
    taskkill /F /PID %%a >nul 2>nul
)

:: 4. Start server (it will automatically open your default browser when ready)
echo [3/3] Starting SceneFlow Studio server...
echo.
echo ========================================================
echo   SceneFlow Studio is LIVE at http://localhost:3000
echo   Opening default browser with link...
echo   Keep this command window open while using SceneFlow.
echo   To stop the server, press Ctrl+C or close this window.
echo ========================================================
echo.

node server.js
pause
