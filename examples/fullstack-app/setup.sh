#!/bin/bash

# Full-Stack SaaS App - Automated Setup Script

set -e

echo "🚀 Setting up Full-Stack SaaS Application..."
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v18 or higher."
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Installing pnpm..."
    npm install -g pnpm
fi

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ pnpm version: $(pnpm --version)"
echo "✅ Docker version: $(docker --version)"
echo ""

# Install dependencies using pnpm workspace
echo "📦 Installing dependencies with pnpm workspaces..."
echo ""

pnpm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the application, run:"
echo "  pnpm run orc start"
echo "  # or: pnpm run start"
echo ""
echo "Once running, access:"
echo "  - Admin Dashboard:   http://localhost:4200"
echo "  - Customer Portal:   http://localhost:4201"
echo "  - API Server:        http://localhost:3000"
echo "  - API Documentation: http://localhost:8080"
echo ""
