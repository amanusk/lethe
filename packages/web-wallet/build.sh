#!/bin/bash
set -e

# Navigate to repo root (two levels up from packages/web-wallet)
cd "$(dirname "$0")/../.."

# Determine cargo home - use /root in Vercel, $HOME locally
if [ "$VERCEL" = "1" ] || [ -d "/root" ]; then
  CARGO_HOME="/root/.cargo"
  RUSTUP_HOME="/root/.rustup"
else
  CARGO_HOME="${HOME}/.cargo"
  RUSTUP_HOME="${HOME}/.rustup"
fi

echo "Installing Rust (CARGO_HOME=$CARGO_HOME)..."
# Set HOME to /root in Vercel so rustup installs to the right place
if [ "$VERCEL" = "1" ] || [ -d "/root" ]; then
  export HOME="/root"
fi
CARGO_HOME="$CARGO_HOME" RUSTUP_HOME="$RUSTUP_HOME" HOME="$HOME" curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly-2025-01-07

# Set environment variables
export CARGO_HOME="$CARGO_HOME"
export RUSTUP_HOME="$RUSTUP_HOME"
export PATH="$CARGO_HOME/bin:$PATH"

# Source the env file - it should exist after rustup installation
if [ -f "$CARGO_HOME/env" ]; then
  source "$CARGO_HOME/env"
elif [ -f "/root/.cargo/env" ]; then
  # Fallback: try /root/.cargo/env directly
  source "/root/.cargo/env"
fi

# Verify Rust installation - check both expected location and actual HOME location
if [ ! -f "$CARGO_HOME/bin/rustc" ] && [ ! -f "$CARGO_HOME/bin/cargo" ]; then
  # Fallback: check if rustup installed to actual HOME/.cargo
  if [ -f "${HOME}/.cargo/bin/rustc" ] && [ -f "${HOME}/.cargo/bin/cargo" ]; then
    echo "Rust found in ${HOME}/.cargo/bin, updating CARGO_HOME"
    CARGO_HOME="${HOME}/.cargo"
    RUSTUP_HOME="${HOME}/.rustup"
    export CARGO_HOME="$CARGO_HOME"
    export RUSTUP_HOME="$RUSTUP_HOME"
    export PATH="$CARGO_HOME/bin:$PATH"
  else
    echo "Error: Rust binaries not found in $CARGO_HOME/bin or ${HOME}/.cargo/bin"
    echo "Checking $CARGO_HOME/bin:"
    ls -la "$CARGO_HOME/bin" 2>&1 || echo "Directory does not exist"
    echo "Checking ${HOME}/.cargo/bin:"
    ls -la "${HOME}/.cargo/bin" 2>&1 || echo "Directory does not exist"
    exit 1
  fi
fi

# Use direct path to cargo to avoid PATH issues
CARGO_BIN="$CARGO_HOME/bin/cargo"
if [ ! -f "$CARGO_BIN" ]; then
  echo "Error: cargo not found in $CARGO_HOME/bin"
  echo "Listing $CARGO_HOME/bin:"
  ls -la "$CARGO_HOME/bin" || echo "Directory does not exist"
  exit 1
fi

# Verify rustc exists
if [ ! -f "$CARGO_HOME/bin/rustc" ]; then
  echo "Error: rustc not found in $CARGO_HOME/bin"
  echo "PATH: $PATH"
  echo "CARGO_HOME: $CARGO_HOME"
  ls -la "$CARGO_HOME/bin" || echo "Directory does not exist"
  exit 1
fi

echo "Rust installation verified. Using cargo from $CARGO_BIN"

echo "Installing wasm-pack..."
# Install wasm-pack via cargo using direct path
"$CARGO_BIN" install wasm-pack

echo "Installing Just..."
# Install just using direct path
"$CARGO_BIN" install just

echo "Building Rust WASM modules..."
# Use just from cargo bin directory
"$CARGO_HOME/bin/just" build || just build

echo "Installing Node.js dependencies..."
corepack enable
yarn install --immutable || yarn install

echo "Building web wallet..."
cd packages/web-wallet
yarn build

echo "Build complete!"


