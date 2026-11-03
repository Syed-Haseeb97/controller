# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller Single-Executable Specification for DS4 Bridge 120Hz Tray App
Build command on Windows:
    pyinstaller --clean --noconfirm "desktop app/ds4_bridge.spec"
Produces:
    dist/DS4Bridge120Hz.exe (No console window, embeds ViGEmClient DLLs from vgamepad)
"""

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

vgamepad_binaries = collect_dynamic_libs("vgamepad")
vgamepad_datas = collect_data_files("vgamepad")

a = Analysis(
    ["ds4_tray_app.py"],
    pathex=["."],
    binaries=vgamepad_binaries,
    datas=vgamepad_datas,
    hiddenimports=["vgamepad", "pystray", "PIL", "qrcode"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="DS4Bridge120Hz",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Runs silently in the Windows System Tray
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
