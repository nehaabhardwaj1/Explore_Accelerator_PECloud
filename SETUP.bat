@echo off
title Explore Accelerator — Python Setup
echo.
echo Explore Accelerator — Python/FastAPI Setup
echo ================================
echo.

:: Check Python 3.10+
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Please install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo Python version: %PYVER%

:: Create virtual environment
if exist ".venv\" (
    echo Virtual environment already exists — skipping creation.
) else (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
)

:: Activate and install
call .venv\Scripts\activate.bat
echo Installing Python dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: pip install failed. Check your internet connection.
    pause
    exit /b 1
)

echo. > .deps_installed
echo.
echo Setup complete!
echo.
echo Next steps:
echo   1. Install the Chrome extension: SAPDeckAgent_v27/
echo   2. Open SAP for Me Process Navigator, run extension -> Load Full Catalog -> Save to Cartridge
echo   3. Run START.bat to launch the server
echo.
pause
