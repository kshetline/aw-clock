#!/bin/bash

if [[ "$1" =~ ^--help|-h$ ]]; then
  echo "Usage: sudo ./build.sh [--acu] [--ddev] [--dht] [--help] [-i]"
  echo "                       [--launch] [--pt] [--reboot] [--sd] [--tarp]"
  exit
fi

if [ "$EUID" != 0 ]; then
  echo "This installer must be run as root (sudo ./build.sh)"
  exit
fi

if [ ! `which node` ]; then
  version=0
else
  version=`node --version`
  pattern='v?([0-9]+)'
  [[ $version =~ $pattern ]]
  version="${BASH_REMATCH[1]}"
fi

if (( version < 12 )); then
  echo "Installing nodejs. This could take several minutes..."
  apt-get update
  curl -sL https://deb.nodesource.com/setup_12.x | bash -
  apt-get install -y nodejs
fi

if [ ! -f ".first-time-install" ]; then
  echo "Installing npm packages."
  echo "Warning: first time installation of node-sass can be VERY slow!"
  npm i

  if [ "$SUDO_USER" ]; then
    chown -R "$SUDO_USER" node_modules
  fi

  touch .first-time-install
fi

npm run build -- --bash $*
