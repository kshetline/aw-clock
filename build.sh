#!/bin/bash
if [[ "$1" =~ ^--help|-h$ ]]; then
  echo "Usage: sudo ./build.sh [--acu] [--admin] [--ddev] [--dht] [--gps] [--help] [-i]"
  echo "                       [--kiosk] [--launch] [--pt] [--reboot] [--sd]"
  echo "                       [--skip-upgrade] [--tarp]"
  echo ""
  echo "The options --acu, --admin, --dht, and --kiosk can be followed by an extra"
  echo "dash (e.g. --acu-) to clear a previously enabled option."
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
  elif [ -n "$path" ]; then
    args=(--path \""$path"\")
    path="${args[*]}"
  fi
fi

echo "Starting main installer..."
# shellcheck disable=SC2090,SC2048,SC2086
node build.js -p $path --bash $*
