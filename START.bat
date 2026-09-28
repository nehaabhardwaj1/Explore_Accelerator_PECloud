@echo off
title Explore Accelerator — SAP S/4HANA Cloud PE (Python/FastAPI)
echo.
echo  ███████╗██╗   ██╗██╗      ██████╗██████╗ ██╗   ██╗███╗   ███╗
echo  ██╔════╝██║   ██║██║     ██╔════╝██╔══██╗██║   ██║████╗ ████║
echo  █████╗  ██║   ██║██║     ██║     ██████╔╝██║   ██║██╔████╔██║
echo  ██╔══╝  ██║   ██║██║     ██║     ██╔══██╗██║   ██║██║╚██╔╝██║
echo  ██║     ╚██████╔╝███████╗╚██████╗██║  ██║╚██████╔╝██║ ╚═╝ ██║
echo  ╚═╝      ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝
echo.
echo  SAP S/4HANA Cloud Public Edition — KDD Generator (Python/FastAPI)
echo  ================================================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from python.org
    pause
    exit /b 1
)

:: Install dependencies if requirements.txt is newer than installed marker
if not exist ".venv\" (
    echo Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat

if not exist ".deps_installed" (
    echo Installing Python dependencies...
    pip install -r requirements.txt -q
    echo. > .deps_installed
)

:: Start server
echo.
echo  Starting server on http://localhost:3000
echo  Press Ctrl+C to stop.
echo.
python server.py

pause
