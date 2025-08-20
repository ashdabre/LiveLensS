#!/bin/sh
set -e

echo "Starting Python backend on port 5001..."
python app.py &

echo "Starting signaling server on port 4000..."
node signaling_server.js &

wait -n
