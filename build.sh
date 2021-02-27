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
path="$(sudo -u "$SUDO_USER" bash -c ./build_get_path.sh)"
pattern='^(.*\/\.nvm\/[^:]*):'
[[ $path =~ $pattern ]]
path="${BASH_REMATCH[1]}"

echo "Starting main installer..."
# shellcheck disable=SC2048,SC2086 # this should become separate items with spaces in between, not one quoted thing
npm run build:prod -- --path "$path" --bash $*
