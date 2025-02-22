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

current_npm_version() {
  local version=0

  if [ "$(command -v npm)" ]; then
    version=$(npm --version 2>&1)

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
  curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.39.0/install.sh | bash
  # shellcheck disable=SC2155
  export NVM_DIR="$(nvm_install_dir)"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
}

# Sync version changes with build.ts
sadVersion=10
minAptGetVersion=18
minVersion=18
maxVersion=20
absMaxVersion=24
free=$(free || echo "4194304")
pattern='([0-9]+)'
[[ $free =~ $pattern ]]
free="${BASH_REMATCH[1]}"

# If less than 2G RAM, go with Node 12 instead
if (( free < 1500000 )); then
  minVersion=12
  maxVersion=12
  absMaxVersion=12
elif (( free > 8000000 )); then
  minVersion=20
  maxVersion=24
  absMaxVersion=999
fi

version="$(current_node_version)"
origVersion="$version"

if (( version > absMaxVersion )) && [ ! -s "$NVM_DIR/nvm.sh" ]; then
  install_nvm
fi

if (( version < maxVersion )) && [ -s "$NVM_DIR/nvm.sh" ] && [ $(nvm version-remote $maxVersion) != "N/A" ]; then
  if [ "$(nvm use "v$maxVersion")" ]; then
    nvm use "v$maxVersion"
    nvm alias default "$maxVersion"
  else
    echo "Installing Node.js v$maxVersion via nvm. This could take several minutes..."
    nvm install v"$maxVersion" && nvm use v"$maxVersion" && nvm alias default "$maxVersion"
  fi

  version="$(current_node_version)"
fi

if ( (( version < minVersion )) && (( minVersion >= minAptGetVersion )) ); then
  echo "Installing Node.js. This could take several minutes..."
  sudo apt-get update
  curl -sL https://deb.nodesource.com/setup_"$minVersion".x | sudo bash -
  sudo apt-get install -y nodejs
  version="$(current_node_version)"
fi

# Check version again. Version 10 can annoyingly supersede version 12 with apt-get.
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

  [ -d "$HOME/.nvm" ] && rm -rf "$HOME/.nvm"
  export PATH="$originalPath"
  version="$(current_node_version)"

  re="[^:]*nvm[^:]*:(.*)"
  if (( version < 0 )) && [[ "$PATH" =~ $re ]]; then
    export PATH="${BASH_REMATCH[1]}"
    version="$(current_node_version)"
  fi
fi

if (( version < sadVersion )); then
  echo "Failed to install minimal version of Node.js"
  echo "failed" > node_path.txt
  exit;
fi

if [ ! "$(command -v npm)" ]; then
  echo "Installing npm as a separate step"
  sudo apt-get install -y npm
fi

if [ ! -f ".first-time-install" ] || [ ! -d "node_modules/@tubular/util" ] || [ "$origVersion" -ne "$version" ]; then
  echo "Installing npm packages. This process can be very slow!"

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

npm_version="$(current_npm_version)"

if (( npm_version < 7 )); then
  echo "Updating npm to at least version 7"
  sudo npm i -g "npm@>=7"
fi

pattern='^(.*\/\.nvm\/[^:]*):'
[[ $PATH =~ $pattern ]]
echo "${BASH_REMATCH[1]}" > node_path.txt
