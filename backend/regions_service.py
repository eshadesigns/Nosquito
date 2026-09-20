"""
Regions loading for app.py: builds regions.enriched.json on demand, caches it
in memory, and falls back to the raw regions.json if the build fails.

    from regions_service import load_regions, ensure_regions

    ensure_regions()            # at startup

    @app.get("/api/regions")
    def regions():
        return jsonify(load_regions())
"""

import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent          # backend/
DATA = BASE / "data"
BUILDER = BASE.parent / "src" / "build_regions.py"

REGIONS_PATH = DATA / "regions.enriched.json"   # generated
SOURCE_PATH = DATA / "regions.json"             # hand-maintained

# If any of these is newer than the built file, the build is stale.
SOURCES = [
    SOURCE_PATH,
    DATA / "d_Cases_by_County_Historic_2025.csv",
    DATA / "dengue_Cases_by_County_Current.csv",
    BUILDER,
]

_cache = None


def is_stale() -> bool:
    if not REGIONS_PATH.exists():
        return True
    built = REGIONS_PATH.stat().st_mtime
    return any(s.exists() and s.stat().st_mtime > built for s in SOURCES)


def ensure_regions(force: bool = False) -> bool:
    """
    Build regions.enriched.json if it is missing or out of date.
    Returns True if the enriched file is usable afterwards.
    """
    global _cache

    if not force and not is_stale():
        return REGIONS_PATH.exists()

    if not BUILDER.exists():
        print(f"[regions] builder not found at {BUILDER}")
        return REGIONS_PATH.exists()

    why = "missing" if not REGIONS_PATH.exists() else "out of date"
    print(f"[regions] {REGIONS_PATH.name} is {why}; building...")

    result = subprocess.run(
        [sys.executable, str(BUILDER)],
        capture_output=True,
        text=True,
        timeout=600,
    )

    for line in result.stdout.splitlines():
        print(f"[regions]   {line}")

    # Always surface stderr. The builder exits 0 when the GLOBE fetch fails
    # and writes null mosquito counts, so a silent success here would hide
    # the fact that a whole layer came back empty.
    for line in result.stderr.strip().splitlines():
        if line:
            print(f"[regions]   ! {line}")

    if result.returncode != 0:
        print(f"[regions] build failed (exit {result.returncode})")
        return REGIONS_PATH.exists()

    _cache = None  # force a re-read
    print(f"[regions] built {REGIONS_PATH.name}")
    return REGIONS_PATH.exists()


def load_regions() -> list:
    """
    Return the enriched regions, building them if needed.

    Falls back to the plain regions.json so the map still renders when the
    build fails — a dashboard missing its dengue layer beats a blank screen.
    """
    global _cache

    if _cache is not None and not is_stale():
        return _cache

    ensure_regions()

    path = REGIONS_PATH if REGIONS_PATH.exists() else SOURCE_PATH
    if path is SOURCE_PATH:
        print("[regions] serving un-enriched regions.json as a fallback")

    _cache = json.loads(path.read_text())
    return _cache