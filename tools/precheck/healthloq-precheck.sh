#!/usr/bin/env bash
# HealthLOQ Pre-Installation Check — macOS / Linux wrapper
#
# Usage:
#   bash tools/precheck/healthloq-precheck.sh
#   bash tools/precheck/healthloq-precheck.sh /custom/app/root
#
# What this script does:
#   1. Validates the Node.js environment (version, node_modules, native modules)
#   2. Calls healthloq-precheck.js for the full connectivity and config check
#   3. An HTML report is saved in tools/precheck/ — email it to support if needed.

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YLW='\033[0;33m'
GRN='\033[0;32m'
BLD='\033[1m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

STEP_FAILED=0

pass()  { echo -e "  ${GRN}[PASS]${NC} $*"; }
warn()  { echo -e "  ${YLW}[WARN]${NC} $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $*"; STEP_FAILED=1; }
info()  { echo    "  [INFO] $*"; }
ruler() { echo    "  -------------------------------------------------------"; }
hdr()   { echo    "  Step $*"; }

echo ""
echo -e "  ${BLD}HealthLOQ Pre-Installation Check${NC}"
echo    "  ===================================================="
echo    "  App root : $APP_ROOT"
echo ""

# =============================================================================
#  STEP 1 — Is Node.js installed and reachable?
# =============================================================================
hdr "1/5 : Checking for Node.js..."

if ! command -v node &>/dev/null; then
    fail "Node.js is not found in PATH."
    echo ""
    ruler
    echo "  How to fix:"
    echo ""
    echo "  macOS — Homebrew (recommended):"
    echo "    brew install node"
    echo ""
    echo "  macOS / Linux — nvm (recommended for developers):"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    echo "    source ~/.bashrc   # or ~/.zshrc"
    echo "    nvm install --lts"
    echo "    nvm use --lts"
    echo ""
    echo "  Direct download:"
    echo "    https://nodejs.org/en/download/"
    echo ""
    echo "  After installing, open a NEW terminal and run this script again."
    ruler
    echo ""
    exit 1
fi

# =============================================================================
#  STEP 2 — Is the Node.js version new enough?
# =============================================================================
hdr "2/5 : Checking Node.js version..."

NODE_VER="$(node --version 2>&1)" || {
    fail "Node.js binary was found but failed to execute."
    echo "  The installation may be corrupt. Reinstall from https://nodejs.org"
    exit 1
}

# Strip 'v' and extract major version
NODE_MAJOR="$(echo "$NODE_VER" | tr -d 'v' | cut -d. -f1)"
info "Node.js $NODE_VER detected."

if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    fail "Node.js $NODE_VER is too old. Minimum required: v18."
    echo ""
    ruler
    echo "  Upgrade options:"
    echo ""
    echo "  nvm:"
    echo "    nvm install --lts && nvm use --lts"
    echo ""
    echo "  Homebrew:"
    echo "    brew upgrade node"
    echo ""
    echo "  Direct download:"
    echo "    https://nodejs.org/en/download/"
    echo ""
    echo "  After upgrading, open a NEW terminal and run this script again."
    ruler
    echo ""
    exit 1
fi

pass "Node.js $NODE_VER  (v18+ required)"

# =============================================================================
#  STEP 3 — Is npm available?
# =============================================================================
hdr "3/5 : Checking npm..."

if ! command -v npm &>/dev/null; then
    warn "npm not found in PATH."
    echo "         npm is normally installed alongside Node.js."
    echo "         Reinstalling Node.js from https://nodejs.org usually fixes this."
    echo "         Repair commands referenced later may not work without npm."
else
    NPM_VER="$(npm --version 2>&1)" || NPM_VER="(unknown)"
    pass "npm $NPM_VER"
fi

# =============================================================================
#  STEP 4 — Are dependencies installed?
# =============================================================================
hdr "4/5 : Checking node_modules..."

if [ ! -d "$APP_ROOT/node_modules" ]; then
    fail "node_modules directory not found at $APP_ROOT"
    echo ""
    ruler
    echo "  Fix:"
    echo "    cd \"$APP_ROOT\""
    echo "    npm install"
    echo ""
    echo "  Then run this script again."
    ruler
    echo ""
    exit 1
fi
pass "node_modules found."

# =============================================================================
#  STEP 5 — Does the native SQLite module load?
# =============================================================================
hdr "5/5 : Checking native module (better-sqlite3)..."

SQLITE_ERR="$(cd "$APP_ROOT" && node -e "require('better-sqlite3')" 2>&1)"
SQLITE_RC=$?

if [ $SQLITE_RC -ne 0 ]; then
    fail "Native module (better-sqlite3) failed to load."
    echo ""
    echo "  Error: $SQLITE_ERR" | head -5
    echo ""
    ruler
    echo "  This almost always means Node.js was updated AFTER the app was"
    echo "  installed, so the prebuilt binary no longer matches Node.js."
    echo ""
    echo "  Fix:"
    echo "    cd \"$APP_ROOT\""
    echo "    npm rebuild better-sqlite3"
    echo ""
    echo "  If rebuild fails with 'xcrun' or 'Xcode' errors (macOS):"
    echo "    xcode-select --install"
    echo "    npm rebuild better-sqlite3"
    echo ""
    echo "  If rebuild fails with 'python not found' or 'make' errors (Linux):"
    echo "    sudo apt-get install -y build-essential python3   # Debian/Ubuntu"
    echo "    sudo yum groupinstall 'Development Tools'         # RHEL/CentOS"
    echo "    npm rebuild better-sqlite3"
    echo ""
    echo "  If all else fails:"
    echo "    npm install"
    echo ""
    echo "  After fixing, run this script again to confirm."
    ruler
    echo ""
    exit 1
fi
pass "better-sqlite3 loaded successfully."

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
    echo -e "  ${GRN}${BLD} All checks passed.  Ready to install.${NC}"
    echo    "  ===================================================="
else
    echo    "  ===================================================="
    echo -e "  ${RED}${BLD} One or more checks FAILED.${NC}"
    echo    "  Review the output above and the HTML report saved"
    echo    "  in tools/precheck/."
    echo    "  Email the HTML report to support@healthloq.com"
    echo    "  for installation assistance."
    echo    "  ===================================================="
fi
echo ""
exit $FINAL_RC
