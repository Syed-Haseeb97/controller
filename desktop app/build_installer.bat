@echo off
echo =====================================================================
echo  DS4 Bridge 120Hz - Single-File Windows Tray App Builder (PyInstaller)
echo =====================================================================

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo.
echo [1/2] Running automated hot-path & protocol verification suite...
python automated_test_suite.py
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Verification suite failed! Aborting build.
    exit /b 1
)

echo.
echo [2/2] Packaging single-file Windows executable dist\DS4Bridge120Hz.exe...
pyinstaller --clean --noconfirm ds4_bridge.spec

echo.
echo =====================================================================
echo  BUILD COMPLETE: dist\DS4Bridge120Hz.exe
echo =====================================================================
