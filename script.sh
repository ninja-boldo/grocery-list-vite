#!/usr/bin/env bash
set -euo pipefail

# 1️⃣ Deactivate any currently active pyenv env
pyenv deactivate || true

# 2️⃣ Delete old virtualenv if it exists
if pyenv virtualenvs --bare | grep -qx "grocery_list_server"; then
  echo "Deleting old virtualenv grocery_list_server"
  pyenv virtualenv-delete -f "grocery_list_server"
else
  echo "No existing grocery_list_server env found — skipping delete"
fi

# 3️⃣ Ensure Python 3.11.4 is installed
if ! pyenv versions --bare | grep -qx "3.11.4"; then
  echo "Installing Python 3.11.4"
  pyenv install 3.11.4
else
  echo "Python 3.11.4 already installed"
fi

# 4️⃣ Create new virtualenv
echo "Creating new grocery_list_server virtualenv"
pyenv virtualenv 3.11.4 grocery_list_server

# 5️⃣ Activate it locally
echo "Setting grocery_list_server as local environment"
pyenv local grocery_list_server

# 6️⃣ Upgrade pip & install dependencies
echo "Upgrading pip and installing packages..."
pip install --upgrade pip setuptools wheel

if [[ -f "requirements.txt" ]]; then
  pip install -r requirements.txt
else
  echo "No requirements.txt found — skipping dependency install"
fi

# 7️⃣ Install uvloop for faster asyncio
echo "Installing uvloop..."
pip install uvloop

echo "✅ Environment 'grocery_list_server' is now ready and active."
