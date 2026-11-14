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
    echo [ERROR] Node.js was not found in your system PATH!
    echo Please install Node.js from https://nodejs.org/ and run this again.
    echo.
    pause
    exit /b 1
)

:: 2. Verify dependencies
if not exist "node_modules" (
    echo [1/3] Installing dependencies (first-time setup)...
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
    echo Stopping previous server on port 3000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>nul
)

:: 4. Launch browser and start server
echo [3/3] Launching SceneFlow Studio...
echo.
echo ========================================================
echo   SceneFlow Studio is LIVE at http://localhost:3000
echo   Keep this command window open while using SceneFlow.
echo   To stop the server, press Ctrl+C or close this window.
echo ========================================================
echo.

:: Launch browser in background
start "" http://localhost:3000

:: Start server
node server.js
pause
