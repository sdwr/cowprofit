#!/bin/bash
# Runner script for mwi-tracker sprite
# This runs the calculation and pushes to GitHub

set -e

cd /home/sprite/mwi-tracker

# Ensure dependencies
pip install -q requests numpy

# Run the generator
python generate_site.py

# Git push
git config user.email "bot@mwi-tracker"
git config user.name "MWI Tracker Bot"
git add index.html data.json
git commit -m "Update $(date -u +%Y-%m-%d_%H:%M)" || echo "No changes"
git push origin main

echo "Done!"
