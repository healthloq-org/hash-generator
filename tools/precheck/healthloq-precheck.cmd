@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo.
echo  HealthLOQ Pre-Installation Check
echo  ====================================================
echo.

REM ── Resolve app root (two directories above this script's location) ──────────
pushd "%~dp0..\.." 2>nul
if errorlevel 1 (
    echo  [ERROR] Cannot resolve app root directory.
    echo          Make sure the tools\precheck\ folder is inside the app folder.
    pause & exit /b 2
)
set APP_ROOT=%CD%
popd

echo  App root : %APP_ROOT%
echo.

REM =============================================================================
REM  STEP 1 — Is Node.js installed and in PATH?
REM =============================================================================

echo  Step 1/5 : Checking for Node.js...

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [FAIL] Node.js is not found in PATH.
    echo.
    echo  ---------------------------------------------------------------
    echo  How to fix:
    echo.
    echo    1. Download Node.js LTS from:
    echo       https://nodejs.org/en/download/
    echo.
    echo    2. Run the installer.
    echo       On the "Custom Setup" page, ensure "Add to PATH" is checked
    echo       (it is selected by default).
    echo.
    echo    3. CLOSE this window completely.
    echo       Open a NEW Command Prompt and run this script again.
    echo.
    echo  If Node.js IS installed but not found here, the PATH is missing it.
    echo  Common install locations:
    echo    C:\Program Files\nodejs\
    echo    C:\Program Files (x86)\nodejs\
    echo    %APPDATA%\nvm\   ^(if using nvm-windows^)
    echo.
    echo  To add it manually:
    echo    Settings ^> System ^> Advanced system settings
    echo    ^> Environment Variables ^> Path ^> Edit ^> New
    echo    Add the full path to the nodejs folder.
    echo  ---------------------------------------------------------------
    echo.
    pause & exit /b 1
)

REM =============================================================================
REM  STEP 2 — Is the Node.js version new enough?
REM =============================================================================

echo  Step 2/5 : Checking Node.js version...

for /f "tokens=*" %%V in ('node --version 2^>^&1') do set NODE_VER=%%V
if errorlevel 1 (
    echo.
    echo  [FAIL] Node.js binary found but failed to execute.
    echo.
    echo  The installation may be corrupt or incompatible with this OS version.
    echo  Reinstall Node.js LTS from https://nodejs.org/en/download/
    echo.
    pause & exit /b 1
)

REM Extract the major version number (strip the leading 'v' then take digits before first dot)
set "_VER=%NODE_VER:v=%"
for /f "tokens=1 delims=." %%M in ("%_VER%") do set NODE_MAJOR=%%M

echo  [INFO] Node.js %NODE_VER% found.

if !NODE_MAJOR! LSS 18 (
    echo.
    echo  [FAIL] Node.js %NODE_VER% is too old.  Minimum required: v18.
    echo.
    echo  ---------------------------------------------------------------
    echo  Upgrade options:
    echo.
    echo    Option A — Direct download (recommended for most users):
    echo      https://nodejs.org/en/download/
    echo      Download the Windows Installer (.msi) for the LTS release
    echo      and run it to upgrade.
    echo.
    echo    Option B — Using nvm-windows:
    echo      nvm install lts
    echo      nvm use lts
    echo.
    echo  After upgrading, open a NEW Command Prompt and run this again.
    echo  ---------------------------------------------------------------
    echo.
    pause & exit /b 1
)

echo  [PASS] Node.js %NODE_VER%

REM =============================================================================
REM  STEP 3 — Is npm available?
REM =============================================================================

echo  Step 3/5 : Checking npm...

where npm >nul 2>&1
if errorlevel 1 (
    echo  [WARN] npm not found in PATH.
    echo         Some repair commands referenced below may not work.
    echo         npm is normally installed alongside Node.js.
    echo         Reinstalling from https://nodejs.org usually fixes this.
) else (
    for /f "tokens=*" %%V in ('npm --version 2^>^&1') do echo  [PASS] npm %%V
)

REM =============================================================================
REM  STEP 4 — Are dependencies installed?
REM =============================================================================

echo  Step 4/5 : Checking node_modules...

if not exist "%APP_ROOT%\node_modules\" (
    echo.
    echo  [FAIL] node_modules directory not found.
    echo.
    echo  ---------------------------------------------------------------
    echo  Fix:
    echo    1. Open a Command Prompt
    echo    2. Run:
    echo         cd "%APP_ROOT%"
    echo         npm install
    echo    3. Wait for it to finish, then run this script again.
    echo  ---------------------------------------------------------------
    echo.
    pause & exit /b 1
)
echo  [PASS] node_modules found.

REM =============================================================================
REM  STEP 5 — Does the native SQLite module load correctly?
REM =============================================================================

echo  Step 5/5 : Checking native module (better-sqlite3)...

pushd "%APP_ROOT%"
node -e "require('better-sqlite3')" >nul 2>&1
set SQLITE_RC=!errorlevel!
popd

if !SQLITE_RC! NEQ 0 (
    echo.
    echo  [FAIL] Native module (better-sqlite3) failed to load.
    echo.
    echo  ---------------------------------------------------------------
    echo  This almost always means Node.js was updated AFTER the app was
    echo  installed, so the prebuilt binary no longer matches Node.js.
    echo.
    echo  Fix — open a Command Prompt and run these commands:
    echo.
    echo    cd "%APP_ROOT%"
    echo    npm rebuild better-sqlite3
    echo.
    echo  If "npm rebuild" reports "MSBuild not found" or
    echo  "Visual C++ is required", install the free runtime first:
    echo.
    echo    https://aka.ms/vs/17/release/vc_redist.x64.exe
    echo.
    echo  Then retry:
    echo    npm rebuild better-sqlite3
    echo.
    echo  If rebuild still fails:
    echo    npm install
    echo.
    echo  After fixing, run this script again to confirm.
    echo  ---------------------------------------------------------------
    echo.
    pause & exit /b 1
)
echo  [PASS] better-sqlite3 loaded successfully.

REM =============================================================================
REM  Hand off to the full Node.js precheck
REM =============================================================================

echo.
echo  Node.js environment is OK.
echo  Running full connectivity and configuration check...
echo.

node "%~dp0healthloq-precheck.js" "%APP_ROOT%"
set FINAL_RC=!errorlevel!

echo.
if !FINAL_RC! EQU 0 (
    echo  ====================================================
    echo   All checks passed.  Ready to install.
    echo  ====================================================
) else (
    echo  ====================================================
    echo   One or more checks FAILED.
    echo   Review the output above and the HTML report saved
    echo   in the tools\precheck\ folder.
    echo   Email the HTML report to support@healthloq.com
    echo   for installation assistance.
    echo  ====================================================
)
echo.
pause
exit /b !FINAL_RC!
