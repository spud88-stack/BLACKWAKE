#!/bin/sh
# Serve the game locally, then open http://127.0.0.1:8417
exec python3 "$(dirname "$0")/tools/serve.py" 8417
