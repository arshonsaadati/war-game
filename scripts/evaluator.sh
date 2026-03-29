#!/usr/bin/env bash
#
# War Game Evaluator Loop
# Runs tests, feeds failures to Claude CLI (Opus 4.6 thinking) for fixing, repeats.
#
# Usage:
#   ./scripts/evaluator.sh [max_iterations] [--auto-commit]
#
# The loop:
#   1. Run vitest + custom harness + tsc
#   2. If all pass → done
#   3. If failures → invoke Claude Opus 4.6 with thinking to fix
#   4. Claude fixes code → loop back to step 1
#

set -euo pipefail

MAX_ITERATIONS="${1:-20}"
AUTO_COMMIT="${2:-}"
ITERATION=0
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${BLUE}[evaluator]${NC} $1"; }
success() { echo -e "${GREEN}[evaluator]${NC} $1"; }
warn() { echo -e "${YELLOW}[evaluator]${NC} $1"; }
error() { echo -e "${RED}[evaluator]${NC} $1"; }
info() { echo -e "${CYAN}[evaluator]${NC} $1"; }

cd "$PROJECT_DIR"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  log "Installing dependencies..."
  npm install
fi

# Consecutive pass counter — keep going to build features
CONSECUTIVE_PASSES=0

log "Starting evaluator loop (max ${MAX_ITERATIONS} iterations)"
log "Using: Claude Opus 4.6 with extended thinking"
echo ""

while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
  ITERATION=$((ITERATION + 1))
  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "  Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # --- Step 1: Run vitest ---
  log "Running unit tests..."
  VITEST_OUTPUT=""
  VITEST_EXIT=0
  VITEST_OUTPUT=$(npx vitest run --reporter=verbose 2>&1) || VITEST_EXIT=$?

  # --- Step 2: Run custom harness ---
  log "Running evaluator harness..."
  HARNESS_OUTPUT=""
  HARNESS_EXIT=0
  HARNESS_OUTPUT=$(npx tsx tests/harness.ts 2>&1) || HARNESS_EXIT=$?

  # --- Step 3: Run TypeScript type check ---
  log "Running type check..."
  TSC_OUTPUT=""
  TSC_EXIT=0
  TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || TSC_EXIT=$?

  # --- Step 4: Try building with vite ---
  log "Running vite build check..."
  VITE_OUTPUT=""
  VITE_EXIT=0
  VITE_OUTPUT=$(npx vite build 2>&1) || VITE_EXIT=$?

  # --- Evaluate results ---
  TOTAL_FAILURES=0
  FAILURE_REPORT=""

  if [ "$VITEST_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT="${FAILURE_REPORT}

## Vitest Failures
\`\`\`
$(echo "$VITEST_OUTPUT" | tail -80)
\`\`\`
"
    error "  Unit tests: FAIL"
  else
    success "  Unit tests: PASS"
  fi

  if [ "$HARNESS_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT="${FAILURE_REPORT}

## Evaluator Harness Failures
\`\`\`
$(echo "$HARNESS_OUTPUT" | tail -60)
\`\`\`
"
    error "  Harness checks: FAIL"
  else
    success "  Harness checks: PASS"
  fi

  if [ "$TSC_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT="${FAILURE_REPORT}

## TypeScript Compilation Errors
\`\`\`
$(echo "$TSC_OUTPUT" | tail -40)
\`\`\`
"
    error "  Type check: FAIL"
  else
    success "  Type check: PASS"
  fi

  if [ "$VITE_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT="${FAILURE_REPORT}

## Vite Build Errors
\`\`\`
$(echo "$VITE_OUTPUT" | tail -40)
\`\`\`
"
    error "  Vite build: FAIL"
  else
    success "  Vite build: PASS"
  fi

  # --- All pass? ---
  if [ "$TOTAL_FAILURES" -eq 0 ]; then
    CONSECUTIVE_PASSES=$((CONSECUTIVE_PASSES + 1))
    echo ""
    success "━━━ ALL CHECKS PASSED (streak: ${CONSECUTIVE_PASSES}) ━━━"

    if [ "$AUTO_COMMIT" = "--auto-commit" ]; then
      log "Auto-committing..."
      git add -A
      git commit -m "evaluator: all checks pass (iteration ${ITERATION})" || true
    fi

    # After 2 consecutive passes, we're stable — exit
    if [ "$CONSECUTIVE_PASSES" -ge 2 ]; then
      success "Stable after ${CONSECUTIVE_PASSES} consecutive passes. Done!"
      exit 0
    fi

    # First pass — re-run once more to confirm stability
    log "Re-running to confirm stability..."
    continue
  fi

  CONSECUTIVE_PASSES=0

  # --- Failures: invoke Claude Opus 4.6 with thinking ---
  error "  ${TOTAL_FAILURES} check group(s) failed"
  log "Invoking Claude Opus 4.6 (thinking=high) to fix failures..."

  PROMPT="You are the implementer agent for a WebGPU War Game project.
The evaluator has detected test failures. Fix all of them.

IMPORTANT RULES:
- Only modify files that are causing failures
- Do not refactor or add features — just fix the failing tests/checks
- Run 'npx vitest run' after your fixes to verify they pass
- Run 'npx tsx tests/harness.ts' to verify harness checks pass
- If a shader struct doesn't match TS, fix the TS side to match the shader (shader is source of truth for GPU structs)
- If there are type errors, read the relevant files and fix the types
- If vite build fails, check imports and module resolution

${FAILURE_REPORT}

Fix all failures. The full project is in the current directory.
After fixing, verify by running: npx vitest run && npx tsx tests/harness.ts && npx tsc --noEmit"

  # Invoke Claude with:
  #   --model claude-opus-4-6: Use Opus 4.6
  #   --thinking high: Enable extended thinking for complex fixes
  #   --print: Non-interactive mode
  #   --allowedTools: Scoped tool access
  claude --print \
    --model claude-opus-4-6 \
    --allowedTools "Edit,Write,Read,Bash(npx vitest*),Bash(npx tsx*),Bash(npx tsc*),Bash(npx vite*),Bash(cat *),Glob,Grep" \
    -p "$PROMPT" 2>&1 | tail -80

  echo ""
  log "Claude finished fixes. Re-running tests..."

  if [ "$AUTO_COMMIT" = "--auto-commit" ]; then
    git add -A
    git commit -m "evaluator: fix attempt (iteration ${ITERATION})" || true
  fi
done

error "Max iterations (${MAX_ITERATIONS}) reached without all checks passing."
error "Manual intervention needed."
exit 1
