@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv"

call :ensure_venv
if errorlevel 1 exit /b 1

"%VENV_DIR%\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
cd backend
"..\%VENV_DIR%\Scripts\python.exe" run.py

endlocal
exit /b 0

:ensure_venv
call :venv_usable "%VENV_DIR%"
if not errorlevel 1 exit /b 0

if /I "%VENV_DIR%"==".venv" (
  call :venv_usable ".venv_windows"
  if not errorlevel 1 (
    echo Existing .venv is not usable; using .venv_windows instead.
    set "VENV_DIR=.venv_windows"
    exit /b 0
  )
)

if exist "%VENV_DIR%" (
  echo Existing %VENV_DIR% is not usable; recreating it.
  rmdir /s /q "%VENV_DIR%" >nul 2>nul
  if exist "%VENV_DIR%" (
    echo Could not remove %VENV_DIR%; using .venv_windows instead.
    set "VENV_DIR=.venv_windows"
  )
)

call :venv_usable "%VENV_DIR%"
if not errorlevel 1 exit /b 0

if exist "%VENV_DIR%" (
  echo Existing %VENV_DIR% is not usable; recreating it.
  rmdir /s /q "%VENV_DIR%" >nul 2>nul
  if exist "%VENV_DIR%" (
    echo Could not remove %VENV_DIR%.
    exit /b 1
  )
)

call :create_venv "%VENV_DIR%"
exit /b %errorlevel%

:venv_usable
if not exist "%~1\Scripts\python.exe" exit /b 1
"%~1\Scripts\python.exe" -c "import sys" >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0

:create_venv
py -3 -m venv "%~1" >nul 2>nul
if errorlevel 1 (
  python -m venv "%~1"
)
exit /b %errorlevel%
