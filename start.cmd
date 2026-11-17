@echo off
cd /d "%~dp0"
echo.
echo   CHITIN - local server
echo   http://localhost:8080
echo.
echo   Close this window to stop the server.
echo.
start "" http://localhost:8080
py serve.py 8080
