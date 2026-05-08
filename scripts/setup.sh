#!/usr/bin/env bash
set -e

echo "======================================="
echo " PSX Market Intelligence Engine v2.0  "
echo "======================================="

# ── Node version check ───────────────────────────────────────────────
NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>&1 || true)
if ! node -e "if(parseInt(process.version.slice(1)) < 18) process.exit(1)"; then
  echo "ERROR: Node.js 18+ required. Current: $(node -v)"
  exit 1
fi
echo "[OK] Node.js $(node -v)"

# ── Install backend deps ──────────────────────────────────────────────
echo ""
echo "[1/4] Installing backend dependencies..."
cd backend
npm ci --omit=dev
echo "[OK] Backend deps installed"

# ── Install Playwright browsers ───────────────────────────────────────
echo ""
echo "[2/4] Installing Playwright Chromium..."
npx playwright install chromium --with-deps 2>&1 | tail -5
echo "[OK] Playwright ready"

cd ..

# ── Install frontend deps ─────────────────────────────────────────────
echo ""
echo "[3/4] Installing frontend dependencies..."
cd frontend
npm ci
echo "[OK] Frontend deps installed"

# ── Build frontend ────────────────────────────────────────────────────
echo ""
echo "[4/4] Building frontend..."
npm run build
echo "[OK] Frontend built → ./frontend/dist/"

cd ..

# ── Copy .env ─────────────────────────────────────────────────────────
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo ""
  echo "[INFO] Copied .env.example → backend/.env"
  echo "       Edit backend/.env to customise settings."
fi

mkdir -p logs

echo ""
echo "======================================="
echo " Setup complete! Start commands:"
echo ""
echo "  PM2 (recommended):"
echo "    pm2 start ecosystem.config.js"
echo "    pm2 logs psx-backend"
echo ""
echo "  Manual:"
echo "    cd backend && node src/index.js"
echo ""
echo "  Docker:"
echo "    docker compose up -d"
echo ""
echo "  Frontend dev server:"
echo "    cd frontend && npm run dev"
echo "======================================="
