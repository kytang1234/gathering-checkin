@echo off
title Gathering Check-in
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

chcp 65001 >nul
node scripts\launch.mjs
if errorlevel 1 pause
exit /b 0

:nonode
echo.
echo   Node.js not found.
echo   Install Node.js 22 LTS from https://nodejs.org/
echo   then run start.bat again.
echo.
pause
exit /b 1
