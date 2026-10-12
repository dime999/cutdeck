@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nije instaliran. Skini ga sa https://nodejs.org & pause & exit /b 1)
node src/server.js
pause
