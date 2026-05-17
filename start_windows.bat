@echo off
setlocal

cd /d "%~dp0"

call :ensure_venv
if errorlevel 1 exit /b 1

".venv\Scripts\python.exe" -m pip install -r requirements.txt
cd backend
"..\.venv\Scripts\python.exe" run.py

endlocal
exit /b 0

:ensure_venv
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" -c "import sys" >nul 2>nul
  if not errorlevel 1 exit /b 0
  echo Existing .venv is not usable; recreating it.
  rmdir /s /q ".venv"
)

py -3 -m venv .venv
if errorlevel 1 (
  python -m venv .venv
)
exit /b %errorlevel%
