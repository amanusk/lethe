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
CARGO_HOME="$CARGO_HOME" RUSTUP_HOME="$RUSTUP_HOME" curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly-2025-01-07

# Set PATH immediately after Rust installation
export PATH="$CARGO_HOME/bin:$PATH"
export CARGO_HOME="$CARGO_HOME"
export RUSTUP_HOME="$RUSTUP_HOME"

# Source the env file if it exists
if [ -f "$CARGO_HOME/env" ]; then
  source "$CARGO_HOME/env"
fi

# Verify Rust is accessible
if ! command -v rustc &> /dev/null; then
  echo "Error: rustc not found in PATH"
  echo "PATH: $PATH"
  exit 1
fi

echo "Installing wasm-pack..."
# Install wasm-pack via cargo instead of the installer script to avoid PATH issues
cargo install wasm-pack

echo "Installing Just..."
cargo install just

echo "Building Rust WASM modules..."
just build

echo "Installing Node.js dependencies..."
corepack enable
yarn install --immutable || yarn install

echo "Building web wallet..."
cd packages/web-wallet
yarn build

echo "Build complete!"

