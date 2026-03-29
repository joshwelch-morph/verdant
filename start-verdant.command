#!/bin/bash
cd "$(dirname "$0")"
echo "🌿 Starting Verdant..."
echo "Open http://localhost:3000 in your browser"
echo "Keep this window open while using the app."
echo "Press Ctrl+C to stop."
npx serve . --listen 3000
