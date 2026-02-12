#!/bin/bash
# One-time setup for the sprite

cd /home/sprite

# Clone repo (will need to be created first)
git clone https://github.com/sdwr/mwi-tracker.git
cd mwi-tracker

# Download game data
curl -o init_client_info.json https://doh-nuts.github.io/Enhancelator/init_client_info.json

# Install deps
pip install requests numpy

echo "Setup complete!"
