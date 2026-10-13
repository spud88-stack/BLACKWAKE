#!/bin/sh
# Headless test suite. Uses the JavaScript shell that ships with macOS (no Node needed).
# Usage: ./test.sh            run everything
#        ./test.sh lurker     run tests whose name contains "lurker"
cd "$(dirname "$0")"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
if [ -x "$JSC" ]; then exec "$JSC" -e "globalThis.ONLY='$1'" -m tests/run.js; fi
if command -v node >/dev/null 2>&1; then exec node --input-type=module -e "globalThis.print=console.log;globalThis.quit=(c)=>process.exit(c);globalThis.ONLY='$1';await import('./tests/run.js')"; fi
echo "No JavaScript shell found (need macOS jsc or Node 18+)"; exit 2
