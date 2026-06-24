#!/usr/bin/env bash
# HealthLOQ Pre-Installation Check -- macOS / Linux wrapper
#
# Usage:
#   bash tools/precheck/healthloq-precheck.sh
#   bash tools/precheck/healthloq-precheck.sh /path/to/app
#
# The script validates the Node.js environment, then calls
# healthloq-precheck.js for the full connectivity and config check.
# An HTML report is saved alongside this script -- email it to support if needed.
#
# Can be run from any directory.  If no app root is found or passed, the
# script runs in pre-install mode and skips app-specific checks.

# -- Colours ------------------------------------------------------------------
RED='\033[0;31m'
YLW='\033[0;33m'
GRN='\033[0;32m'
BLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT=""
STEP_FAILED=0

pass() { echo -e "  ${GRN}[PASS]${NC} $*"; }
warn() { echo -e "  ${YLW}[WARN]${NC} $*"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $*"; STEP_FAILED=1; }
info() { echo    "  [INFO] $*"; }
skip() { echo    "  [SKIP] $*"; }
sep()  { echo    "  ----------------------------------------------------"; }

echo ""
echo -e "  ${BLD}HealthLOQ Pre-Installation Check${NC}"
echo    "  ===================================================="
echo ""

# -- Locate app root ----------------------------------------------------------
# Priority: explicit arg > two levels up (tools/precheck/ layout) > none

if [ -n "${1:-}" ] && [ -f "$1/package.json" ]; then
    APP_ROOT="$1"
fi

if [ -z "$APP_ROOT" ]; then
    _candidate="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd)"
    if [ -f "$_candidate/package.json" ]; then
        APP_ROOT="$_candidate"
    fi
fi

if [ -z "$APP_ROOT" ]; then
    if [ -f "$SCRIPT_DIR/package.json" ]; then
        APP_ROOT="$SCRIPT_DIR"
    fi
fi

if [ -z "$APP_ROOT" ]; then
    info "No app installation found -- running in pre-install mode."
    echo "         To also check an existing install, run:"
    echo "           bash healthloq-precheck.sh /path/to/app"
    echo ""
    APP_ROOT="none"
else
    echo "  App root : $APP_ROOT"
    echo ""
fi

# =============================================================================
#  STEP 1 -- Is Node.js installed and reachable?
# =============================================================================
echo "  Step 1/5: Checking for Node.js..."

if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is not found in PATH."
    echo ""
    sep
    echo "  How to fix:"
    echo ""
    echo "  macOS -- Homebrew (recommended):"
    echo "    brew install node"
    echo ""
    echo "  macOS / Linux -- nvm (recommended for developers):"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    echo "    source ~/.bashrc   # or ~/.zshrc"
    echo "    nvm install --lts && nvm use --lts"
    echo ""
    echo "  Direct download:"
    echo "    https://nodejs.org/en/download/"
    echo ""
    echo "  After installing, open a NEW terminal and run this script again."
    sep
    echo ""
    exit 1
fi

# =============================================================================
#  STEP 2 -- Is the Node.js version new enough?
# =============================================================================
echo "  Step 2/5: Checking Node.js version..."

NODE_VER="$(node --version 2>&1)" || {
    fail "Node.js binary found but failed to execute."
    echo "  The installation may be corrupt. Reinstall from https://nodejs.org"
    exit 1
}

NODE_MAJOR="$(echo "$NODE_VER" | tr -d 'v' | cut -d. -f1)"
info "Node.js $NODE_VER detected."

if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    fail "Node.js $NODE_VER is too old.  Minimum required: v18."
    echo ""
    sep
    echo "  Upgrade options:"
    echo ""
    echo "  nvm:      nvm install --lts && nvm use --lts"
    echo "  Homebrew: brew upgrade node"
    echo "  Direct:   https://nodejs.org/en/download/"
    echo ""
    echo "  After upgrading, open a NEW terminal and run this script again."
    sep
    echo ""
    exit 1
fi
pass "Node.js $NODE_VER  (v18+ required)"

# =============================================================================
#  STEP 3 -- Is npm available?
# =============================================================================
echo "  Step 3/5: Checking npm..."

if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found in PATH."
    echo "         npm is normally installed alongside Node.js."
    echo "         Reinstalling Node.js from https://nodejs.org usually fixes this."
else
    NPM_VER="$(npm --version 2>&1)" || NPM_VER="(unknown)"
    pass "npm $NPM_VER"
fi

# =============================================================================
#  STEP 4 -- Are dependencies installed? (skip in pre-install mode)
# =============================================================================
echo "  Step 4/5: Checking node_modules..."

if [ "$APP_ROOT" = "none" ]; then
    skip "Pre-install mode -- no app root found."
else
    if [ ! -d "$APP_ROOT/node_modules" ]; then
        fail "node_modules not found at $APP_ROOT"
        echo ""
        sep
        echo "  Fix:"
        echo "    cd \"$APP_ROOT\""
        echo "    npm install"
        sep
        echo ""
        exit 1
    fi
    pass "node_modules found."
fi

# =============================================================================
#  STEP 5 -- Does the native SQLite module load? (skip in pre-install mode)
# =============================================================================
echo "  Step 5/5: Checking native module (better-sqlite3)..."

if [ "$APP_ROOT" = "none" ]; then
    skip "Pre-install mode -- no app root found."
else
    SQLITE_ERR="$(cd "$APP_ROOT" && node -e "require('better-sqlite3')" 2>&1)"
    SQLITE_RC=$?

    if [ $SQLITE_RC -ne 0 ]; then
        fail "Native module (better-sqlite3) failed to load."
        echo ""
        echo "  Error: $(echo "$SQLITE_ERR" | head -1)"
        echo ""
        sep
        echo "  This usually means Node.js was updated after the app was installed."
        echo ""
        echo "  Fix:"
        echo "    cd \"$APP_ROOT\""
        echo "    npm rebuild better-sqlite3"
        echo ""
        echo "  macOS -- if you see xcrun or Xcode errors:"
        echo "    xcode-select --install"
        echo "    npm rebuild better-sqlite3"
        echo ""
        echo "  Linux -- if you see python or make errors:"
        echo "    sudo apt-get install -y build-essential python3   # Debian/Ubuntu"
        echo "    sudo yum groupinstall 'Development Tools'         # RHEL/CentOS"
        echo "    npm rebuild better-sqlite3"
        echo ""
        echo "  If rebuild still fails:"
        echo "    npm install"
        sep
        echo ""
        exit 1
    fi
    pass "better-sqlite3 loaded successfully."
fi

# =============================================================================
#  Hand off to the full Node.js precheck
# =============================================================================
echo ""
echo    "  Node.js environment is OK."
echo    "  Running full connectivity and configuration check..."
echo ""

node "$SCRIPT_DIR/healthloq-precheck.js" "$APP_ROOT"
FINAL_RC=$?

echo ""
if [ $FINAL_RC -eq 0 ]; then
    echo    "  ===================================================="
    echo -e "  ${GRN}${BLD}All checks passed.${NC}"
    echo    "  ===================================================="
else
    echo    "  ===================================================="
    echo -e "  ${RED}${BLD}One or more checks failed.${NC}"
    echo    "  Review the output above and the HTML report saved"
    echo    "  alongside this script."
    echo    "  Email the HTML report to HealthLOQ support for help."
    echo    "  ===================================================="
fi
echo ""
exit $FINAL_RC
