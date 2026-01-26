#!/bin/bash
# Cron wrapper script for invoice reconcile system
# This script should be called by cron to run the system

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Change to project directory
cd "$PROJECT_DIR" || exit 1

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
elif [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Run the main script
# Redirect both stdout and stderr to log file with timestamp
# Add src to PYTHONPATH for imports
PYTHONPATH="$PROJECT_DIR/src:$PYTHONPATH" python src/main.py >> "logs/cron_$(date +%Y%m%d).log" 2>&1

# Exit with the same code as the Python script
exit $?
