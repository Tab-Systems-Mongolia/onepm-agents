"""Run the plugin's tests with Hermes's own interpreter and dependencies.

    "$(sed -n 's/^exec \\([^ ]*\\) .*/\\1/p' ~/.local/bin/hermes | head -1)" hermes/tests/run.py

Set HERMES_AGENT_DIR when Hermes isn't at ~/.hermes/hermes-agent.
"""

import os
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
AGENT_DIR = os.environ.get("HERMES_AGENT_DIR") or str(Path.home() / ".hermes" / "hermes-agent")
sys.path[:0] = [AGENT_DIR, str(HERE.parent)]

import hermes_bootstrap  # noqa: E402,F401  puts Hermes's dependencies (aiohttp) on sys.path

outcome = unittest.main(module=None, argv=[sys.argv[0], "discover", "-s", str(HERE), "-v"], exit=False)
sys.exit(0 if outcome.result.wasSuccessful() else 1)
