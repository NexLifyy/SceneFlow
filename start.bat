@echo off
setlocal
title SceneFlow Studio

echo ========================================================
echo   Starting SceneFlow Studio...
echo ========================================================
echo.

cd /d "%~dp0"

:: 1. Check if node_modules exists
if not exist "node_modules" (
    echo [1/3] Installing Node.js packages...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to install Node dependencies.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Node dependencies verified.
)

:: 2. Check if .venv exists
if not exist ".venv\Scripts\python.exe" (
    echo [2/3] Setting up local Whisper transcription environment...
    call setup-whisper.bat
) else (
    echo [2/3] Whisper Python environment verified.
)

:: 3. Start server and launch browser
echo [3/3] Launching SceneFlow server...
echo.
echo Application will be available at: http://localhost:3000
echo Press Ctrl+C in this window to stop the server.
echo.

:: Open default browser after a brief delay
start "" http://localhost:3000

:: Start server
node server.js
