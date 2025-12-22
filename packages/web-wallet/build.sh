#!/bin/bash
set -e

# Navigate to repo root (two levels up from packages/web-wallet)
cd "$(dirname "$0")/../.."

echo "Installing Rust..."
CARGO_HOME=/root/.cargo RUSTUP_HOME=/root/.rustup curl -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly-2025-01-07
source /root/.cargo/env

echo "Installing wasm-pack..."
curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh

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

