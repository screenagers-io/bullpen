#!/bin/sh
# Bullpen installer for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/screenagers-io/bullpen/main/install.sh | sh
# Starts from nothing: installs Herdr (its official installer, into ~/.local/bin) and Node.js (no sudo: a
# private copy under ~/.bullpen/node) when they are missing, installs Bullpen from GitHub into ~/.bullpen,
# links the `bullpen` command into ~/.local/bin and, on macOS, creates ~/Applications/Bullpen.app.
# Re-run it to update Bullpen. Options via env: BULLPEN_REF=main, BULLPEN_NO_APP=1, BULLPEN_NO_HERDR=1.
set -eu

REPO="${BULLPEN_REPO:-screenagers-io/bullpen}"
REF="${BULLPEN_REF:-main}"
PREFIX="${BULLPEN_PREFIX:-$HOME/.bullpen}"
BIN_DIR="${BULLPEN_BIN_DIR:-$HOME/.local/bin}"
MIN_NODE=18
NODE_MAJOR_TO_INSTALL=22

say()  { printf '\033[1;36mbullpen\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mbullpen\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in Darwin) PLAT=darwin ;; Linux) PLAT=linux ;; *) fail "unsupported OS: $OS (use install.ps1 on Windows)" ;; esac
case "$ARCH" in arm64|aarch64) NARCH=arm64 ;; x86_64|amd64) NARCH=x64 ;; *) fail "unsupported CPU: $ARCH" ;; esac

# --- git -------------------------------------------------------------------
if ! have git; then
  if [ "$PLAT" = darwin ]; then
    say "git is missing; macOS will offer to install the Command Line Tools"
    xcode-select --install 2>/dev/null || true
    fail "install git (Command Line Tools) and run this again"
  elif have apt-get; then say "installing git with apt"; sudo apt-get install -y git
  elif have dnf; then say "installing git with dnf"; sudo dnf install -y git
  else fail "git is required; install it with your package manager and run this again"; fi
fi

# --- herdr -------------------------------------------------------------------
HERDR_DIR="${HERDR_INSTALL_DIR:-$HOME/.local/bin}"
if have herdr || [ -x "$HERDR_DIR/herdr" ]; then
  say "herdr $("$(command -v herdr || echo "$HERDR_DIR/herdr")" --version 2>/dev/null | awk '{print $2}') is installed"
elif [ -n "${BULLPEN_NO_HERDR:-}" ]; then
  say "skipping Herdr (BULLPEN_NO_HERDR is set)"
else
  say "Herdr not found; running its installer from https://herdr.dev (into $HERDR_DIR)"
  curl -fsSL https://herdr.dev/install.sh | HERDR_INSTALL_DIR="$HERDR_DIR" sh || fail "Herdr's installer failed; see https://herdr.dev for other install methods"
  [ -x "$HERDR_DIR/herdr" ] || fail "Herdr's installer finished but $HERDR_DIR/herdr is missing"
  HERDR_INSTALLED=1
fi

# --- node --------------------------------------------------------------------
node_ok() { have "$1" && v="$("$1" -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)" && [ "${v:-0}" -ge "$MIN_NODE" ]; }
NODE=""
if node_ok node; then NODE="$(command -v node)"
elif node_ok "$PREFIX/node/bin/node"; then NODE="$PREFIX/node/bin/node"
else
  say "Node.js $MIN_NODE+ not found; downloading Node $NODE_MAJOR_TO_INSTALL into $PREFIX/node (no sudo needed)"
  mkdir -p "$PREFIX"
  SUMS="$(curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR_TO_INSTALL.x/SHASUMS256.txt")" || fail "could not reach nodejs.org"
  FILE="$(printf '%s\n' "$SUMS" | grep -o "node-v[0-9.]*-$PLAT-$NARCH.tar.gz" | head -1)"
  [ -n "$FILE" ] || fail "no Node build for $PLAT-$NARCH"
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR_TO_INSTALL.x/$FILE" -o "$TMP/$FILE"
  printf '%s\n' "$SUMS" | grep " $FILE\$" > "$TMP/sum"
  ( cd "$TMP" && (have shasum && shasum -a 256 -c sum >/dev/null || sha256sum -c sum >/dev/null) ) || fail "Node download failed its checksum"
  rm -rf "$PREFIX/node"; mkdir -p "$PREFIX/node"
  tar xzf "$TMP/$FILE" -C "$PREFIX/node" --strip-components=1
  rm -rf "$TMP"
  NODE="$PREFIX/node/bin/node"
fi
NODE_DIR="$(dirname "$NODE")"
say "using node $("$NODE" -v) at $NODE"

# --- bullpen ------------------------------------------------------------------
say "installing Bullpen from github.com/$REPO#$REF into $PREFIX"
mkdir -p "$PREFIX" "$BIN_DIR"
PATH="$NODE_DIR:$PATH" "$NODE_DIR/npm" install -g --prefix "$PREFIX" --no-fund --no-audit --loglevel=error "git+https://github.com/$REPO.git#$REF" \
  || fail "npm could not fetch github.com/$REPO. Check your network (and git credentials if the repo is private), then retry."

PKG_BIN="$PREFIX/lib/node_modules/bullpen-office/bin/bullpen.mjs"
[ -f "$PKG_BIN" ] || fail "install finished but $PKG_BIN is missing"
rm -f "$BIN_DIR/bullpen"   # npm may have left a symlink here; never write through it
cat > "$BIN_DIR/bullpen" <<WRAP
#!/bin/sh
# Bullpen launcher written by install.sh
export PATH="$NODE_DIR:\$PATH"
exec "$NODE" "$PKG_BIN" "\$@"
WRAP
chmod +x "$BIN_DIR/bullpen"
VERSION="$("$BIN_DIR/bullpen" --version)"
say "installed bullpen $VERSION -> $BIN_DIR/bullpen"

# --- PATH hint ------------------------------------------------------------------
RC=""; case "${SHELL:-}" in */zsh) RC="$HOME/.zshrc" ;; */bash) RC="$HOME/.bashrc" ;; esac
for D in "$BIN_DIR" "$HERDR_DIR"; do
  case ":$PATH:" in *":$D:"*) continue ;; esac
  if [ -n "$RC" ] && ! grep -qs "export PATH=\"$D:" "$RC"; then
    printf '\n# bullpen / herdr\nexport PATH="%s:$PATH"\n' "$D" >> "$RC"; say "added $D to PATH in $RC (takes effect in a new terminal)"
  elif [ -z "$RC" ]; then say "add $D to your PATH"; fi
done

# --- macOS app --------------------------------------------------------------------
if [ "$PLAT" = darwin ] && [ -z "${BULLPEN_NO_APP:-}" ] && have osacompile; then
  APP="$HOME/Applications/Bullpen.app"; mkdir -p "$HOME/Applications"; rm -rf "$APP"
  osacompile -o "$APP" -e "do shell script \"'$BIN_DIR/bullpen' --no-open >> \\\"\$HOME/Library/Logs/bullpen.log\\\" 2>&1 & sleep 1.5; open http://127.0.0.1:4877\"" >/dev/null 2>&1 \
    && say "created $APP (double-click to start Bullpen and open it)" || say "could not create Bullpen.app; run 'bullpen' from a terminal instead"
fi

# --- agent CLIs --------------------------------------------------------------------
AGENT_FOUND=""
for a in claude codex gemini copilot cursor-agent opencode cline amp; do have "$a" && AGENT_FOUND="$AGENT_FOUND $a"; done

echo
say "done."
if [ -n "${HERDR_INSTALLED:-}" ]; then
  say "1. open a new terminal and run:  herdr        (Herdr's workspace; agents run inside it)"
else
  say "1. run  herdr  in a terminal if it is not already open"
fi
say "2. run:  bullpen        (or  bullpen --demo  to look around without agents)"
if [ -z "$AGENT_FOUND" ]; then
  say "no coding-agent CLI found yet. Herdr drives tools like Claude Code, Codex or Gemini CLI; install at least one, e.g."
  say "   npm install -g @anthropic-ai/claude-code      (or use Bullpen's + Agent button once one is installed)"
else
  say "agent CLIs found:$AGENT_FOUND"
fi
