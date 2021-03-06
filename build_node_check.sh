#!/bin/bash

echo "Checking installation pre-requisites..."
[ -s "$HOME/.bashrc" ] && \. "$HOME/.bashrc"

nvm_default_install_dir() {
  [ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm"
}

nvm_install_dir() {
  if [ -n "$NVM_DIR" ]; then
    printf %s "${NVM_DIR}"
  else
    nvm_default_install_dir
  fi
}

current_node_version() {
  local version=0

  if [ "$(command -v node)" ]; then
    version=$(node --version 2>&1)

    if [[ $version =~ "No such file" ]]; then
      version=-1
    else
      local pattern='([0-9]+)'
      [[ $version =~ $pattern ]]
      version="${BASH_REMATCH[1]}"
    fi
  fi

  printf %s "$version"
}

# shellcheck disable=SC2155
export NVM_DIR="$(nvm_install_dir)"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
bashrcBackup=
originalPath="$PATH"

install_nvm() {
  echo "Installing nvm (Node Version Manager)"
  # Be prepared to back out nvm installation in case it fails
  bashrcBackup="$HOME/.bashrc".bak
  export NVM_DIR=
  cp "$HOME/.bashrc" "$bashrcBackup"
  curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.37.2/install.sh | bash
  # shellcheck disable=SC2155
  export NVM_DIR="$(nvm_install_dir)"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
}

# Sync version changes with build.ts
minVersion=14
maxVersion=14
free=$(free)
pattern='([0-9]+)'
[[ $free =~ $pattern ]]
free="${BASH_REMATCH[1]}"

# If less than 2G RAM, go with Node 12 instead
if (( free < 2000000 ));then
  minVersion=12
  maxVersion=12
fi

version="$(current_node_version)"
origVersion="$version"

if (( version > maxVersion )) && [ ! -s "$NVM_DIR/nvm.sh" ]; then
  install_nvm
fi

if [ "$version" -ne "$maxVersion" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
  if [ "$(nvm use "v$maxVersion")" ]; then
    nvm use "v$maxVersion"
    nvm alias default "$maxVersion"
  else
    echo "Installing Node.js v$maxVersion via nvm. This could take several minutes..."
    nvm install v"$maxVersion" && nvm use v"$maxVersion" && nvm alias default "$maxVersion"
  fi

  version="$(current_node_version)"
fi

if (( version < minVersion )); then
  echo "Installing Node.js. This could take several minutes..."
  sudo apt-get update
  curl -sL https://deb.nodesource.com/setup_"$minVersion".x | sudo bash -
  sudo apt-get install -y nodejs
  version="$(current_node_version)"
fi

# Check version again. Version 10 can annoyingly supersede version 12.
if (( version < minVersion )); then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    install_nvm
  fi

  echo "Installing Node.js v$minVersion via nvm. This could take several minutes..."
  nvm install v"$minVersion" && nvm use v"$minVersion" && nvm alias default "$minVersion"
  version="$(current_node_version)"
fi

# Are we good yet? Make sure nvm didn't make things worse.
if (( version < 0 )); then
  echo "Using nvm failed. Removing nvm."

  if [ -f "$bashrcBackup" ]; then
    rm "$HOME/.bashrc"
    mv "$bashrcBackup" "$HOME/.bashrc"
  fi

  if [ ! -d "$NVM_DIR" ]; then
    rm -rf "$NVM_DIR"
  fi

  export PATH="$originalPath"
  version="$(current_node_version)"
  # I'd rather not settle for Node 10, but, oh well...
  minVersion=10
fi

if (( version < minVersion )); then
  echo "Failed to install minimal version of Node.js"
  echo "failed" > node_path.txt
  exit;
fi

if [ ! "$(command -v node)" ]; then
  echo "Installing npm as a separate step"
  sudo apt-get install -y npm
fi

if [ ! -f ".first-time-install" ] || [ ! -d "node_modules/@tubular/util" ] || [ "$origVersion" -ne "$version" ]; then
  echo "Installing npm packages."
  echo "Warning: first time installation of node-sass can be VERY slow!"

  # node-sass can cause a mess by not being built with the same version of Node.js.
  # Best to wipe out all of node_modules and start from scratch.
  if [ "$origVersion" -ne "$version" ]; then
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

pattern='^(.*\/\.nvm\/[^:]*):'
[[ $PATH =~ $pattern ]]
echo "${BASH_REMATCH[1]}" > node_path.txt
