@echo off
setlocal
echo =====================================================================
echo  DS4 Bridge 120Hz - Single-File Windows Tray App Builder (PyInstaller)
echo =====================================================================

cd /d "%~dp0"

set PYTHON_CMD=python
if exist ".venv\Scripts\python.exe" (
    set PYTHON_CMD=.venv\Scripts\python.exe
    set PYINSTALLER_CMD=.venv\Scripts\pyinstaller.exe
) else (
    set PYINSTALLER_CMD=pyinstaller
)

set VGAMEPAD_SKIP_VIGEMBUS_INSTALL=true
%PYTHON_CMD% -m pip install -r requirements.txt

echo.
echo [1/2] Running automated hot-path & protocol verification suite...
%PYTHON_CMD% automated_test_suite.py
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Verification suite failed! Aborting build.
    exit /b 1
)

echo.
echo [2/2] Packaging single-file Windows executable dist\DS4Bridge120Hz.exe...
%PYINSTALLER_CMD% --clean --noconfirm ds4_bridge.spec

echo.
echo =====================================================================
echo  BUILD COMPLETE: dist\DS4Bridge120Hz.exe
echo =====================================================================
