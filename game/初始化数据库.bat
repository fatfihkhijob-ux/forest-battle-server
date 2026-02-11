@echo off
title Init DB
cd /d "%~dp0"
echo Make sure MySQL is running, then press any key...
pause >nul
python init_db.py
echo.
pause
