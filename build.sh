#!/bin/bash
if [[ "$1" =~ ^--help|-h$ ]]; then
  echo "Usage: sudo ./build.sh [--acu] [--admin] [--ddev] [--dht] [--firefox]"
  echo "                       [--fullscreen] [--gps] [--help] [-i] [--launch]"
  echo "                       [--kiosk] [-p] [--pt] [--reboot] [--sd]"
  echo "                       [--skip-upgrade] [--tarp]"
  echo ""
  echo "The options --acu, --admin, --dht, --firefox, --fullscreen, and --kiosk"
  echo "can be followed by an extra dash (e.g. --acu-) to clear a previously"
  echo "enabled option."
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
    path0=$path
    args=(--path \""$path"\")
    path="${args[*]}"
  fi
fi

echo "Starting main installer..."
# shellcheck disable=SC2086
"$path0/node" build.js -p $path --bash "$*"
