@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "PY_RUNTIME_DIR=%SCRIPT_DIR%python-runtime"
set "PY_INSTALLER="
set "PY_MODE="

if exist "%SCRIPT_DIR%python-installer.exe" set "PY_INSTALLER=%SCRIPT_DIR%python-installer.exe"
if not defined PY_INSTALLER if exist "%SCRIPT_DIR%python-3.12.10-amd64.exe" set "PY_INSTALLER=%SCRIPT_DIR%python-3.12.10-amd64.exe"

if not exist "%PY_RUNTIME_DIR%\python.exe" (
  if defined PY_INSTALLER (
    echo [prereq] Installing Python runtime to "%PY_RUNTIME_DIR%"
    "%PY_INSTALLER%" /quiet InstallAllUsers=1 Include_pip=1 Include_test=0 Include_launcher=0 PrependPath=0 Shortcuts=0 TargetDir="%PY_RUNTIME_DIR%"
    if errorlevel 1 (
      echo [prereq] Python installer returned error code %errorlevel%
    )
  ) else (
    echo [prereq] No local Python installer found. Skipping local Python install.
  )
)

if exist "%PY_RUNTIME_DIR%\python.exe" (
  set "PY_MODE=runtime"
) else (
  where python >nul 2>&1
  if not errorlevel 1 set "PY_MODE=python"
)

if not defined PY_MODE (
  where py >nul 2>&1
  if not errorlevel 1 set "PY_MODE=py"
)

if not defined PY_MODE (
  echo [prereq] Python is not available. Skipping PyMuPDF installation.
  exit /b 0
)

echo [prereq] Installing Python packages (pip, pymupdf)...

if "%PY_MODE%"=="runtime" (
  "%PY_RUNTIME_DIR%\python.exe" -m pip install --upgrade pip
  if errorlevel 1 exit /b 1
  "%PY_RUNTIME_DIR%\python.exe" -m pip uninstall -y fitz >nul 2>&1
  "%PY_RUNTIME_DIR%\python.exe" -m pip install --upgrade pymupdf
  if errorlevel 1 exit /b 1
  "%PY_RUNTIME_DIR%\python.exe" -c "import fitz; print('PyMuPDF ready')"
  if errorlevel 1 exit /b 1
)

if "%PY_MODE%"=="python" (
  python -m pip install --upgrade pip
  if errorlevel 1 exit /b 1
  python -m pip uninstall -y fitz >nul 2>&1
  python -m pip install --upgrade pymupdf
  if errorlevel 1 exit /b 1
  python -c "import fitz; print('PyMuPDF ready')"
  if errorlevel 1 exit /b 1
)

if "%PY_MODE%"=="py" (
  py -3 -m pip install --upgrade pip
  if errorlevel 1 exit /b 1
  py -3 -m pip uninstall -y fitz >nul 2>&1
  py -3 -m pip install --upgrade pymupdf
  if errorlevel 1 exit /b 1
  py -3 -c "import fitz; print('PyMuPDF ready')"
  if errorlevel 1 exit /b 1
)

echo [prereq] Prerequisite installation completed.
exit /b 0
