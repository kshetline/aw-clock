#!/bin/bash

if [[ "$1" =~ ^--help|-h$ ]]; then
  echo "Usage: sudo ./build.sh [--acu] [--ddev] [--dht] [--help] [-i]\n'"
  echo "                       [--launch] [--pt] [--reboot] [--sd] [--tarp]"
  exit
fi

if [ "$EUID" -ne 0 ]; then
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
  echo "Installing nodejs. This will take several minutes..."
  apt-get update
  curl -sL https://deb.nodesource.com/setup_12.x | bash -
  apt-get install -y nodejs
fi

npm i
npm run build -- --bash $*
