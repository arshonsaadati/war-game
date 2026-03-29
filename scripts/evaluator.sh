#!/usr/bin/env bash
#
# War Game Evaluator Loop
# Runs tests, feeds failures to Claude CLI for fixing, repeats.
#
# Usage:
#   ./scripts/evaluator.sh [max_iterations] [--auto-commit]
#
# The loop:
#   1. Run vitest + custom harness
#   2. If all pass → done (or continue to next feature)
#   3. If failures → invoke Claude CLI with structured failure report
#   4. Claude fixes code → loop back to step 1
#

set -euo pipefail

MAX_ITERATIONS="${1:-10}"
AUTO_COMMIT="${2:-}"
ITERATION=0
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[evaluator]${NC} $1"; }
success() { echo -e "${GREEN}[evaluator]${NC} $1"; }
warn() { echo -e "${YELLOW}[evaluator]${NC} $1"; }
error() { echo -e "${RED}[evaluator]${NC} $1"; }

cd "$PROJECT_DIR"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  log "Installing dependencies..."
  npm install
fi

log "Starting evaluator loop (max ${MAX_ITERATIONS} iterations)"
echo ""

while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
  ITERATION=$((ITERATION + 1))
  log "━━━ Iteration ${ITERATION}/${MAX_ITERATIONS} ━━━"

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

  # --- Evaluate results ---
  TOTAL_FAILURES=0
  FAILURE_REPORT=""

  if [ "$VITEST_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT="${FAILURE_REPORT}

## Vitest Failures
\`\`\`
${VITEST_OUTPUT}
\`\`\`
"
  else
    success "  Unit tests: PASS"
  fi

  if [ "$HARNESS_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT="${FAILURE_REPORT}

## Evaluator Harness Failures
\`\`\`
${HARNESS_OUTPUT}
\`\`\`
"
  else
    success "  Harness checks: PASS"
  fi

  if [ "$TSC_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT="${FAILURE_REPORT}

## TypeScript Compilation Errors
\`\`\`
${TSC_OUTPUT}
\`\`\`
"
  else
    success "  Type check: PASS"
  fi

  # --- All pass? ---
  if [ "$TOTAL_FAILURES" -eq 0 ]; then
    echo ""
    success "━━━ ALL CHECKS PASSED on iteration ${ITERATION} ━━━"

    if [ "$AUTO_COMMIT" = "--auto-commit" ]; then
      log "Auto-committing..."
      git add -A
      git commit -m "evaluator: all checks pass (iteration ${ITERATION})" || true
    fi

    exit 0
  fi

  # --- Failures: invoke Claude to fix ---
  error "  ${TOTAL_FAILURES} check group(s) failed"
  log "Invoking Claude CLI to fix failures..."

  PROMPT="You are the implementer agent for a WebGPU War Game project.
The evaluator has detected test failures. Fix them.

IMPORTANT RULES:
- Only modify files that are causing failures
- Do not refactor or add features — just fix the failing tests
- Run 'npx vitest run' after your fixes to verify
- If a shader struct doesn't match TS, fix the TS side to match the shader (shader is source of truth)

${FAILURE_REPORT}

Fix all failures. The full project is in the current directory."

  # Use claude CLI in non-interactive print mode
  # --print sends the prompt and outputs the response
  # --allowedTools lets it edit files and run tests
  claude --print --allowedTools "Edit,Write,Read,Bash(npx vitest*),Bash(npx tsx*),Bash(npx tsc*),Bash(git *),Glob,Grep" \
    -p "$PROMPT" 2>&1 | tail -50

  echo ""
  log "Claude finished fixes. Re-running tests..."

  if [ "$AUTO_COMMIT" = "--auto-commit" ]; then
    git add -A
    git commit -m "evaluator: fix attempt (iteration ${ITERATION})" || true
  fi

  echo ""
done

error "Max iterations (${MAX_ITERATIONS}) reached without all checks passing."
error "Manual intervention needed."
exit 1
