"""Shared fixtures for the backend test suite.

The sample statements under `import/` double as golden fixtures for the bank
importer: parsing is slow (pdfplumber walks every page), so each file is parsed
once per session and the result cached.
"""
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLES_DIR = REPO_ROOT / "import"

# The service package lives under backend/, which is the container's workdir but
# not necessarily the pytest rootdir.
sys.path.insert(0, str(REPO_ROOT / "backend"))


@pytest.fixture(scope="session")
def parse_sample():
    """Parse a file from `import/` through the real importer, cached per name."""
    from app.services.bank_import import parse_bank_file

    cache = {}

    def _parse(name):
        if name not in cache:
            path = SAMPLES_DIR / name
            if not path.exists():
                pytest.skip(f"sample statement missing: {path}")
            cache[name] = parse_bank_file(path.read_bytes(), name)
        return cache[name]

    return _parse
