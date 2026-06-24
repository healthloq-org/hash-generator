@echo off
setlocal enabledelayedexpansion

echo.
echo  HealthLOQ Pre-Installation Check
echo  ====================================================
echo.

REM ------------------------------------------------------------------
REM  Locate the app root.
REM  Priority:
REM    1. Explicit path passed as first argument
REM    2. Two levels up from this script (tools\precheck\ layout)
REM    3. "none" -- no app found, skip app-specific checks
REM ------------------------------------------------------------------

set "APP_ROOT="

REM -- Arg 1 override
if not "%~1"=="" (
    if exist "%~1\package.json" (
        set "APP_ROOT=%~1"
    )
)

REM -- Auto-detect: two levels up from this script
if "!APP_ROOT!"=="" (
    pushd "%~dp0..\.." 2>nul
    if not errorlevel 1 (
        if exist "!CD!\package.json" (
            set "APP_ROOT=!CD!"
        )
        popd
    ) else (
        popd 2>nul
    )
)

REM -- Auto-detect: script dir itself (user put everything flat)
if "!APP_ROOT!"=="" (
    if exist "%~dp0package.json" (
        set "APP_ROOT=%~dp0"
        if "!APP_ROOT:~-1!"=="\" set "APP_ROOT=!APP_ROOT:~0,-1!"
    )
)

if "!APP_ROOT!"=="" (
    echo  [INFO] No app installation found -- running in pre-install mode.
    echo         To also check an existing install, run:
    echo           healthloq-precheck.cmd "C:\path\to\app"
    echo.
    set "APP_ROOT=none"
)

if not "!APP_ROOT!"=="none" (
    echo  App root : !APP_ROOT!
    echo.
)

REM ==================================================================
REM  STEP 1 -- Is Node.js installed and in PATH?
REM ==================================================================

echo  Step 1/5: Checking for Node.js...

where node >nul 2>&1
if errorlevel 1 goto :node_not_found
goto :node_found

:node_not_found
echo.
echo  [FAIL] Node.js is not found in PATH.
echo.
echo  How to fix:
echo.
echo    1. Download Node.js LTS from:
echo       https://nodejs.org/en/download/
echo.
echo    2. Run the installer.  On the Custom Setup page,
echo       ensure "Add to PATH" is checked ^(it is by default^).
echo.
echo    3. CLOSE this window completely.
echo       Open a NEW Command Prompt and run this script again.
echo.
echo  If Node.js IS installed but not found here, your PATH is missing it.
echo  Common locations:
echo    C:\Program Files\nodejs\
echo    C:\Program Files ^(x86^)\nodejs\
echo.
echo  To add it manually:
echo    Settings ^> System ^> Advanced system settings
echo    ^> Environment Variables ^> Path ^> Edit ^> New
echo    Add the full path to the nodejs folder.
echo.
pause
exit /b 1

:node_found

REM ==================================================================
REM  STEP 2 -- Is the Node.js version new enough?
REM ==================================================================

echo  Step 2/5: Checking Node.js version...

for /f "tokens=*" %%V in ('node --version 2^>^&1') do set "NODE_VER=%%V"
if "!NODE_VER!"=="" goto :node_exec_fail
goto :node_ver_ok

:node_exec_fail
echo.
echo  [FAIL] Node.js binary found but failed to execute.
echo  The installation may be corrupt.
echo  Reinstall from https://nodejs.org
echo.
pause
exit /b 1

:node_ver_ok
set "_VER=!NODE_VER:v=!"
for /f "tokens=1 delims=." %%M in ("!_VER!") do set "NODE_MAJOR=%%M"
echo  [INFO] Node.js !NODE_VER! detected.

if "!NODE_MAJOR!"=="" goto :node_ver_fail
if !NODE_MAJOR! LSS 18 goto :node_ver_fail
goto :node_ver_pass

:node_ver_fail
echo.
echo  [FAIL] Node.js !NODE_VER! is too old.  Minimum required: v18.
echo.
echo  Upgrade options:
echo.
echo    Option A - Download the Windows Installer ^(LTS^):
echo      https://nodejs.org/en/download/
echo.
echo    Option B - Using nvm-windows:
echo      nvm install lts
echo      nvm use lts
echo.
echo  After upgrading, open a NEW Command Prompt and run this again.
echo.
pause
exit /b 1

:node_ver_pass
echo  [PASS] Node.js !NODE_VER!

REM ==================================================================
REM  STEP 3 -- Is npm available?
REM ==================================================================

echo  Step 3/5: Checking npm...

where npm >nul 2>&1
if errorlevel 1 (
    echo  [WARN] npm not found in PATH.
    echo         npm is normally installed alongside Node.js.
    echo         Reinstalling from https://nodejs.org usually fixes this.
) else (
    for /f "tokens=*" %%V in ('npm --version 2^>^&1') do echo  [PASS] npm %%V
)

REM ==================================================================
REM  STEP 4 -- Are dependencies installed? (skip in pre-install mode)
REM ==================================================================

echo  Step 4/5: Checking node_modules...

if "!APP_ROOT!"=="none" (
    echo  [SKIP] Pre-install mode -- no app root found.
    goto :step5
)

if not exist "!APP_ROOT!\node_modules\" goto :no_node_modules
echo  [PASS] node_modules found.
goto :step5

:no_node_modules
echo.
echo  [FAIL] node_modules directory not found at !APP_ROOT!
echo.
echo  Fix:
echo    cd "!APP_ROOT!"
echo    npm install
echo.
echo  Then run this script again.
echo.
pause
exit /b 1

REM ==================================================================
REM  STEP 5 -- Does the native SQLite module load? (skip if no app)
REM ==================================================================

:step5
echo  Step 5/5: Checking native module ^(better-sqlite3^)...

if "!APP_ROOT!"=="none" (
    echo  [SKIP] Pre-install mode -- no app root found.
    goto :run_js
)

pushd "!APP_ROOT!"
node -e "require('better-sqlite3')" >nul 2>&1
set "SQLITE_RC=!errorlevel!"
popd

if !SQLITE_RC! NEQ 0 goto :sqlite_fail
echo  [PASS] better-sqlite3 loaded successfully.
goto :run_js

:sqlite_fail
echo.
echo  [FAIL] Native module ^(better-sqlite3^) failed to load.
echo.
echo  This usually means Node.js was updated after the app was installed.
echo.
echo  Fix:
echo    cd "!APP_ROOT!"
echo    npm rebuild better-sqlite3
echo.
echo  If MSBuild is missing, install the free runtime first:
echo    https://aka.ms/vs/17/release/vc_redist.x64.exe
echo  Then retry:
echo    npm rebuild better-sqlite3
echo.
echo  If rebuild still fails:
echo    npm install
echo.
pause
exit /b 1

REM ==================================================================
REM  Hand off to the full Node.js precheck
REM ==================================================================

:run_js
echo.
echo  Node.js environment is OK.
echo  Running full connectivity and configuration check...
echo.

node "%~dp0healthloq-precheck.js" "!APP_ROOT!"
set "FINAL_RC=!errorlevel!"

echo.
if !FINAL_RC! EQU 0 (
    echo  ====================================================
    echo   All checks passed.
    echo  ====================================================
) else (
    echo  ====================================================
    echo   One or more checks failed.
    echo   Review the output above and the HTML report saved
    echo   in the same folder as this script.
    echo   Email the HTML report to HealthLOQ support for help.
    echo  ====================================================
)
echo.
pause
exit /b !FINAL_RC!