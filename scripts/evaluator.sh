#!/usr/bin/env bash
#
# War Game Autonomous Evaluator Loop
# Runs ALL checks including playing the game in a real browser.
# Passes screenshots to Claude's vision for visual quality review.
# Uses --dangerously-skip-permissions for fully autonomous operation.
# Iterates until perfect — no manual intervention.
#
# Usage:
#   ./scripts/evaluator.sh [max_iterations] [--auto-commit]
#

set -euo pipefail

MAX_ITERATIONS="${1:-30}"
AUTO_COMMIT="${2:-}"
ITERATION=0
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log() { echo -e "${BLUE}[evaluator]${NC} $1"; }
success() { echo -e "${GREEN}[evaluator]${NC} $1"; }
warn() { echo -e "${YELLOW}[evaluator]${NC} $1"; }
error() { echo -e "${RED}[evaluator]${NC} $1"; }

cd "$PROJECT_DIR"

if [ ! -d "node_modules" ]; then
  log "Installing dependencies..."
  npm install
fi

CONSECUTIVE_PASSES=0

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║   WAR GAME AUTONOMOUS EVALUATOR                 ║${NC}"
echo -e "${BOLD}${CYAN}║   Model: Claude Opus 4.6 (vision + thinking)    ║${NC}"
echo -e "${BOLD}${CYAN}║   Mode: --dangerously-skip-permissions          ║${NC}"
echo -e "${BOLD}${CYAN}║   Max iterations: ${MAX_ITERATIONS}                            ║${NC}"
echo -e "${BOLD}${CYAN}║   No manual intervention — iterates to perfect  ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
  ITERATION=$((ITERATION + 1))
  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "  Iteration ${ITERATION}/${MAX_ITERATIONS}"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  TOTAL_FAILURES=0
  TOTAL_WARNINGS=0
  FAILURE_REPORT=""

  # ===== CHECK 1: Unit tests =====
  log "1/5 Unit tests..."
  VITEST_EXIT=0
  VITEST_OUTPUT=$(npx vitest run --reporter=verbose 2>&1) || VITEST_EXIT=$?
  if [ "$VITEST_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT+="
## Unit Test Failures
\`\`\`
$(echo "$VITEST_OUTPUT" | tail -80)
\`\`\`
"
    error "  Unit tests: FAIL"
  else
    success "  Unit tests: PASS"
  fi

  # ===== CHECK 2: Evaluator harness =====
  log "2/5 Evaluator harness..."
  HARNESS_EXIT=0
  HARNESS_OUTPUT=$(npx tsx tests/harness.ts 2>&1) || HARNESS_EXIT=$?
  if [ "$HARNESS_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT+="
## Evaluator Harness Failures
\`\`\`
$(echo "$HARNESS_OUTPUT" | tail -60)
\`\`\`
"
    error "  Harness: FAIL"
  else
    success "  Harness: PASS"
  fi

  # ===== CHECK 3: TypeScript =====
  log "3/5 Type check..."
  TSC_EXIT=0
  TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || TSC_EXIT=$?
  if [ "$TSC_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT+="
## TypeScript Errors
\`\`\`
$(echo "$TSC_OUTPUT" | tail -40)
\`\`\`
"
    error "  TypeScript: FAIL"
  else
    success "  TypeScript: PASS"
  fi

  # ===== CHECK 4: Vite build =====
  log "4/5 Vite build..."
  VITE_EXIT=0
  VITE_OUTPUT=$(npx vite build 2>&1) || VITE_EXIT=$?
  if [ "$VITE_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT+="
## Vite Build Errors
\`\`\`
$(echo "$VITE_OUTPUT" | tail -40)
\`\`\`
"
    error "  Vite build: FAIL"
  else
    success "  Vite build: PASS"
  fi

  # ===== CHECK 5: Browser play test =====
  log "5/5 Browser play test (launching game in Chromium)..."
  BROWSER_EXIT=0
  BROWSER_OUTPUT=$(npx tsx tests/browser/play-game.ts 2>&1) || BROWSER_EXIT=$?
  if [ "$BROWSER_EXIT" -ne 0 ]; then
    TOTAL_FAILURES=$((TOTAL_FAILURES + 1))
    FAILURE_REPORT+="
## Browser Play Test Failures
The evaluator launched the game in a real Chromium browser via Playwright,
navigated to it, clicked Run Battle, tested controls, and checked results.

\`\`\`
$(echo "$BROWSER_OUTPUT" | tail -60)
\`\`\`
"
    error "  Browser: FAIL"
  else
    # Check for warnings even on pass
    BROWSER_WARNS=$(echo "$BROWSER_OUTPUT" | grep -c "⚠" || true)
    if [ "$BROWSER_WARNS" -gt 0 ]; then
      TOTAL_WARNINGS=$((TOTAL_WARNINGS + BROWSER_WARNS))
      warn "  Browser: PASS (${BROWSER_WARNS} warnings)"
    else
      success "  Browser: PASS"
    fi
  fi

  # ===== ALL PASS? =====
  if [ "$TOTAL_FAILURES" -eq 0 ]; then
    CONSECUTIVE_PASSES=$((CONSECUTIVE_PASSES + 1))
    echo ""
    success "━━━ ALL 5 CHECKS PASSED (streak: ${CONSECUTIVE_PASSES}) ━━━"

    if [ "$AUTO_COMMIT" = "--auto-commit" ]; then
      git add -A
      git commit -m "evaluator: all checks pass (iteration ${ITERATION})" 2>/dev/null || true
    fi

    # If there are warnings or this is first pass, do a VISUAL REVIEW
    if [ "$CONSECUTIVE_PASSES" -le 1 ] || [ "$TOTAL_WARNINGS" -gt 0 ]; then
      log "Running visual quality review on screenshots..."

      # Build screenshot args for Claude
      SCREENSHOT_ARGS=""
      if [ -d "test-screenshots" ]; then
        for img in test-screenshots/*.png; do
          if [ -f "$img" ]; then
            SCREENSHOT_ARGS+=" $img"
          fi
        done
      fi

      if [ -n "$SCREENSHOT_ARGS" ]; then
        VISUAL_PROMPT="You are the visual quality evaluator for a WebGPU War Game.

All automated tests pass. Now do a VISUAL REVIEW of the game screenshots.

Look at each screenshot and evaluate:
1. Does the layout look professional? No overlapping elements, proper spacing?
2. Is the color scheme consistent and readable? Dark theme working?
3. Are the battle results displayed clearly?
4. Does the histogram look correct (red/blue bars, centered)?
5. Are there any visual glitches, missing elements, or jank?
6. Does this look like an impressive WebGPU project?

Browser test report is in browser-test-results.json — read it for context.

If everything looks great, respond with just: VISUAL_PASS
If there are issues, describe them and fix the CSS/HTML/rendering code.
After any fixes, run: npx vitest run && npx tsx tests/harness.ts && npx tsc --noEmit

Be critical — this should look polished."

        VISUAL_RESULT=$(claude \
          --dangerously-skip-permissions \
          --print \
          --model claude-opus-4-6 \
          -p "$VISUAL_PROMPT" \
          $SCREENSHOT_ARGS 2>&1) || true

        if echo "$VISUAL_RESULT" | grep -q "VISUAL_PASS"; then
          success "  Visual review: PASS"
        else
          warn "  Visual review: Claude made improvements"
          echo "$VISUAL_RESULT" | tail -20
          CONSECUTIVE_PASSES=0  # Reset — need to re-verify
          if [ "$AUTO_COMMIT" = "--auto-commit" ]; then
            git add -A
            git commit -m "evaluator: visual improvements (iteration ${ITERATION})" 2>/dev/null || true
          fi
          continue
        fi
      fi
    fi

    if [ "$CONSECUTIVE_PASSES" -ge 2 ]; then
      echo ""
      echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════╗${NC}"
      echo -e "${BOLD}${GREEN}║  STABLE — All checks + visual review passed     ║${NC}"
      echo -e "${BOLD}${GREEN}║  ${CONSECUTIVE_PASSES} consecutive passes. Game is ready!          ║${NC}"
      echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════╝${NC}"
      exit 0
    fi

    log "Confirming stability..."
    continue
  fi

  CONSECUTIVE_PASSES=0

  # ===== FAILURES: Invoke Claude to fix =====
  error "  ${TOTAL_FAILURES} check(s) failed"
  log "Invoking Claude Opus 4.6 (--dangerously-skip-permissions)..."

  # Include screenshots if browser test failed
  SCREENSHOT_ARGS=""
  if [ "$BROWSER_EXIT" -ne 0 ] && [ -d "test-screenshots" ]; then
    for img in test-screenshots/*.png; do
      if [ -f "$img" ]; then
        SCREENSHOT_ARGS+=" $img"
      fi
    done
  fi

  PROMPT="You are the implementer agent for a WebGPU War Game project.
The autonomous evaluator has run 5 check groups and detected ${TOTAL_FAILURES} failure(s).

FIX EVERYTHING. This pipeline runs with NO manual intervention.

CHECKS:
1. Unit tests (vitest) — game logic, ECS, shaders, GUI structure
2. Evaluator harness — 60+ structural checks
3. TypeScript — clean compilation
4. Vite build — clean production bundle
5. Browser play test — Playwright launches game, clicks Run Battle, checks results, takes screenshots

RULES:
- Read files before modifying
- Fix root causes
- Shader structs are source of truth for buffer layouts
- Screenshots are in test-screenshots/ — use Read to view them
- browser-test-results.json has the detailed play test report
- After fixes: npx vitest run && npx tsx tests/harness.ts && npx tsc --noEmit && npx vite build

${FAILURE_REPORT}

Fix ALL failures. Verify by running all checks."

  claude \
    --dangerously-skip-permissions \
    --print \
    --model claude-opus-4-6 \
    -p "$PROMPT" \
    $SCREENSHOT_ARGS 2>&1 | tail -100

  echo ""
  log "Claude finished. Re-running all checks..."

  if [ "$AUTO_COMMIT" = "--auto-commit" ]; then
    git add -A
    git commit -m "evaluator: fix iteration ${ITERATION}" 2>/dev/null || true
  fi
done

error "Max iterations (${MAX_ITERATIONS}) reached."
exit 1
