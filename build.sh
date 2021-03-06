#!/bin/bash
if [[ "$1" =~ ^--help|-h$ ]]; then
  echo "Usage: sudo ./build.sh [--acu] [--admin] [--ddev] [--dht] [--gps] [--help] [-i]"
  echo "                       [--launch] [--pt] [--reboot] [--sd] [--skip-upgrade]"
  echo "                       [--tarp]"
  echo ""
  echo "The options --acu, --admin, and --dht can be followed by an extra dash (e.g."
  echo "--acu-) to clear a previously enabled option."
  exit
fi

if [ "$EUID" != 0 ]; then
  echo "This installer must be run as root (sudo ./build.sh)"
  exit
fi

sudo -u "$SUDO_USER" bash -c ./build_node_check.sh

if [ -f "node_path.txt" ]; then
  path="$(cat node_path.txt)"
  rm node_path.txt

  if [ "$path" == "failed" ]; then
    exit;
  else
    path="--path \"$path\""
  fi
fi

echo "Starting main installer..."
# shellcheck disable=SC2048,SC2086 #
npm run build:prod "$path" --bash $*
