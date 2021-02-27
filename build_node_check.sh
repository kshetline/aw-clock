#!/bin/bash

echo "Checking installation pre-requisites..."
\. "$HOME/.bashrc"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

minVersion=14
maxVersion=14
versionChanged=0

if [ ! "$(command -v node)" ]; then
  version=0
else
  version=$(node --version)
  pattern='v?([0-9]+)'
  [[ $version =~ $pattern ]]
  version="${BASH_REMATCH[1]}"
fi

if (( version > maxVersion )) && [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "Installing nvm (Node Version Manager)."
  curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.37.2/install.sh | bash
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
fi

if [ ! "$version" -eq "$maxVersion" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  if [ "$(nvm use v"$maxVersion")" ]; then
    version="$maxVersion"
    nvm alias default "$maxVersion"
    versionChanged=1
  else
    echo "Installing Node.js v12 via nvm. This could take several minutes..."
    nvm install v"$maxVersion" && nvm use v"$maxVersion" && nvm alias default "$maxVersion" && version="$maxVersion" && versionChanged=1
  fi
fi

if (( version < minVersion )); then
  echo "Installing Node.js. This could take several minutes..."
  sudo apt-get update
  curl -sL https://deb.nodesource.com/setup_"$minVersion".x | sudo bash -
  sudo apt-get install -y nodejs
  versionChanged=1
fi

if [ ! -f ".first-time-install" ] || [ ! -d "node_modules/@tubular/util" ] || [ "$versionChanged" -eq 1 ]; then
  echo "Installing npm packages."
  echo "Warning: first time installation of node-sass can be VERY slow!"

  # node-sass can cause a mess by not being built with the same version of Node.js.
  # Best to wipe out all of node_modules and start from scratch.
  if [ "$versionChanged" -eq 1 ]; then
    # shellcheck disable=SC2164
    cd server
    rm package-lock.json
    rm -rf node_modules
    npm i
    # shellcheck disable=SC2103
    cd ..
    rm package-lock.json
    rm -rf node_modules
  fi

  npm i
  touch .first-time-install
fi
