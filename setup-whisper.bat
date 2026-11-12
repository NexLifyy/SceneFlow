@echo off
setlocal
echo ========================================================
echo   Setting up faster-whisper environment for SceneFlow
echo ========================================================

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=python
    goto FOUND_PY
)

where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set PY_CMD=py
    goto FOUND_PY
)

if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" (
    set PY_CMD="%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    goto FOUND_PY
)

if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    set PY_CMD="%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    goto FOUND_PY
)

echo [ERROR] Python not found in PATH!
echo Please install Python 3.10 or 3.11 from https://www.python.org/downloads/
echo Make sure to check "Add Python to PATH" during installation.
pause
exit /b 1

:FOUND_PY
echo Using %PY_CMD%...
if not exist ".venv" (
    echo Creating virtual environment in .venv...
    %PY_CMD% -m venv .venv
)

echo Installing / updating faster-whisper and torch...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r python\requirements.txt

copy /y "C:\Program Files (x86)\Microsoft\EdgeWebView\Application\157.0.4341.42\*.dll" ".venv\Lib\site-packages\ctranslate2\" >nul 2>&1
copy /y "C:\Program Files (x86)\Microsoft\EdgeWebView\Application\157.0.4341.42\*.dll" ".venv\Scripts\" >nul 2>&1

echo.
echo ========================================================
echo   Setup completed successfully!
echo ========================================================
pause
