#!/usr/bin/env python3
"""
Enrich regions.json with mosquito observation counts (GLOBE Observer) and
dengue case counts (CDC county CSVs), writing regions.enriched.json.

Every field already in regions.json is preserved; this only adds keys.

Usage:
    python build_regions.py \
        --regions backend/data/regions.json \
        --dengue-historic d_Cases_by_County_Historic_2025.csv \
        --dengue-current dengue_Cases_by_County_Current.csv \
        --out backend/data/regions.enriched.json

    # skip the GLOBE network call, dengue only:
    python build_regions.py --no-mosquito
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fl_counties import FIPS_BY_ID

# Nosquito/src/build_regions.py -> Nosquito/
REPO = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Florida bounding box. GLOBE data is global; without this, nearest-centroid
# happily labels observations in Brazil and Thailand as Miami-Dade.
# ---------------------------------------------------------------------------
FL_BOX = dict(lat_min=24.0, lat_max=31.3, lon_min=-88.0, lon_max=-79.7)
MAX_CENTROID_KM = 60.0
EARTH_R_KM = 6371.0088

INAT_URL = (
    "https://github.com/geo-di-lab/emerge-geoai/raw/refs/heads/main/"
    "docs/data/mosquito_inaturalist_2020_2025.parquet"
)

# Fallback only; the frontend's own copy is preferred so the map and the
# counts use identical boundaries.
COUNTIES_URL = (
    "https://raw.githubusercontent.com/plotly/datasets/master/"
    "geojson-counties-fips.json"
)

DEFAULT_INAT = REPO / "mosquito_inaturalist_2020_2025.parquet"


def normalize_county(name: str) -> str:
    """'FL, St Johns' / 'St. Johns County' -> 'stjohns'"""
    name = re.sub(r"^[A-Z]{2},\s*", "", str(name or ""))
    name = re.sub(r"\bcounty\b", "", name, flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]", "", name.lower())


# ---------------------------------------------------------------------------
# Dengue
# ---------------------------------------------------------------------------
def parse_cases(raw):
    """
    CDC suppresses small counts, so 'Reported cases' is either an integer
    ('141') or a range string ('1 to 4'). Returns (lo, hi, label, suppressed).

    Keeping both bounds rather than collapsing to a midpoint here means the
    two years can be summed as intervals, so a county suppressed in both
    years reports '2 to 8' instead of an invented '4'.
    """
    text = str(raw).strip()

    if re.fullmatch(r"\d+", text):
        n = int(text)
        return n, n, text, False

    m = re.fullmatch(r"(\d+)\s*to\s*(\d+)", text, flags=re.IGNORECASE)
    if m:
        return int(m.group(1)), int(m.group(2)), text, True

    # '250+' — open-ended upper bound, so hi is the floor too.
    m = re.fullmatch(r"(\d+)\+", text)
    if m:
        n = int(m.group(1))
        return n, n, text, True

    return 0, 0, text, True


def format_range(lo, hi):
    return str(lo) if lo == hi else f"{lo} to {hi}"


def load_dengue(path: Path) -> tuple[dict, int]:
    """Read one CDC CSV, keep Florida rows, key by normalized county name."""
    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"Location": str})
    fl = df[df["Location"].str.startswith("12", na=False)].copy()

    year = int(fl["Year"].iloc[0]) if len(fl) else None
    out = {}

    for _, row in fl.iterrows():
        lo, hi, label, suppressed = parse_cases(row["Reported cases"])
        out[normalize_county(row["FullGeoName"])] = {
            "lo": lo,
            "hi": hi,
            "label": label,
            "suppressed": suppressed,
            "fips": row["Location"],
        }

    print(f"  {path.name}: {len(out)} Florida counties, year {year}")
    return out, year


# ---------------------------------------------------------------------------
# Mosquito observations (iNaturalist)
# ---------------------------------------------------------------------------
def load_inaturalist(parquet: Path) -> "pd.DataFrame":
    """Read the cached iNaturalist export, downloading it once if absent."""
    if not parquet.exists():
        print(f"  downloading {parquet.name} (one time, ~40 MB)")
        parquet.parent.mkdir(parents=True, exist_ok=True)
        import requests

        response = requests.get(INAT_URL, timeout=600)
        response.raise_for_status()
        parquet.write_bytes(response.content)

    return pd.read_parquet(parquet)


def load_county_polygons(path: Path | None) -> "gpd.GeoDataFrame":
    """
    Florida county polygons, keyed by FIPS.

    Prefers the us-counties.geojson the frontend already ships so the map and
    the counts are cut from exactly the same boundaries.
    """
    import geopandas as gpd

    if path and path.exists():
        print(f"  county polygons: {path}")
        counties = gpd.read_file(path)
    else:
        print("  county polygons: downloading (frontend copy not found)")
        import requests

        response = requests.get(COUNTIES_URL, timeout=300)
        response.raise_for_status()
        tmp = Path("/tmp/us-counties.geojson")
        tmp.write_bytes(response.content)
        counties = gpd.read_file(tmp)

    counties["fips"] = counties["id"].astype(str).str.zfill(5)
    florida = counties[counties["fips"].str.startswith("12")].copy()

    if len(florida) != 67:
        print(f"  warning: expected 67 Florida counties, found {len(florida)}")

    return florida[["fips", "geometry"]]


def fetch_mosquito_counts(regions, start: date, end: date,
                          parquet=None, counties_path=None) -> dict:
    """
    Count iNaturalist mosquito observations per Florida county.

    A point-in-polygon join against real county boundaries does the Florida
    filter and the county assignment in one step. That replaces the old
    bounding-box plus nearest-centroid approach, which both let in
    non-Florida points and put borderline sites in the wrong county.
    """
    import geopandas as gpd

    data = load_inaturalist(parquet or DEFAULT_INAT)
    print(f"  {len(data):,} observations worldwide")

    observed = pd.to_datetime(data["observed_on"], errors="coerce")
    in_range = observed.between(pd.Timestamp(start), pd.Timestamp(end))
    data = data[in_range]
    print(f"  {len(data):,} within {start} .. {end}")

    points = gpd.GeoDataFrame(
        data,
        geometry=gpd.points_from_xy(data["longitude"], data["latitude"]),
        crs="EPSG:4326",
    )

    counties = load_county_polygons(counties_path)
    joined = gpd.sjoin(points, counties, predicate="within")

    print(f"  {len(joined):,} inside a Florida county")
    print(f"  {joined['fips'].nunique()} of 67 counties have observations")

    counts = {
        r["id"]: {"observations": 0, "species": 0}
        for r in regions
    }
    id_by_fips = {FIPS_BY_ID[r["id"]]: r["id"] for r in regions if r["id"] in FIPS_BY_ID}

    for fips, group in joined.groupby("fips"):
        region_id = id_by_fips.get(fips)
        if region_id is None:
            print(f"  warning: FIPS {fips} has no matching region")
            continue
        counts[region_id] = {
            "observations": int(len(group)),
            "species": int(group["scientific_name"].nunique()),
        }

    return counts


# ---------------------------------------------------------------------------
def main():
    data_dir = REPO / "backend" / "data"

    p = argparse.ArgumentParser()
    p.add_argument("--regions", type=Path, default=data_dir / "regions.json")
    p.add_argument("--dengue-historic", type=Path,
                   default=data_dir / "d_Cases_by_County_Historic_2025.csv")
    p.add_argument("--dengue-current", type=Path,
                   default=data_dir / "dengue_Cases_by_County_Current.csv")
    p.add_argument("--out", type=Path, default=data_dir / "regions.enriched.json")
    p.add_argument("--mosquito-parquet", type=Path, default=DEFAULT_INAT,
                   help="cached iNaturalist export; downloaded once if absent")
    p.add_argument("--counties-geojson", type=Path, default=None,
                   help="county polygons; defaults to the frontend's us-counties.geojson")
    p.add_argument("--start", default="2020-01-01")
    p.add_argument("--end", default=date.today().isoformat())
    p.add_argument("--no-mosquito", action="store_true",
                   help="skip mosquito counts entirely; those fields are written as null")
    args = p.parse_args()

    parquet = args.mosquito_parquet

    # Prefer the county polygons the frontend already draws, so the counts
    # and the map are cut from the same boundaries.
    counties_path = args.counties_geojson
    if counties_path is None:
        found = sorted(REPO.glob("**/us-counties.geojson"))
        counties_path = found[0] if found else None

    regions = json.loads(Path(args.regions).read_text())
    print(f"loaded {len(regions)} regions")

    print("dengue:")
    historic, historic_year = load_dengue(Path(args.dengue_historic))
    current, current_year = load_dengue(Path(args.dengue_current))

    print("mosquito:")
    if args.no_mosquito:
        print("  skipped (--no-mosquito)")
        counts = None
    else:
        try:
            counts = fetch_mosquito_counts(
                regions,
                date.fromisoformat(args.start),
                date.fromisoformat(args.end),
                parquet=parquet,
                counties_path=counties_path,
            )
        except Exception as e:
            print(f"  mosquito load failed ({e}); writing nulls", file=sys.stderr)
            counts = None

    unmatched = []
    for region in regions:
        key = normalize_county(region["county"])
        region["fips"] = FIPS_BY_ID.get(region["id"])

        blank = {"lo": 0, "hi": 0, "label": "0", "suppressed": False}
        h = historic.get(key, blank)
        c = current.get(key, blank)

        region["dengueHistoric"] = h["hi"] if h["suppressed"] else h["lo"]
        region["dengueHistoricLabel"] = h["label"]
        region["dengueHistoricSuppressed"] = h["suppressed"]
        region["dengueHistoricYear"] = historic_year

        region["dengueCurrent"] = c["hi"] if c["suppressed"] else c["lo"]
        region["dengueCurrentLabel"] = c["label"]
        region["dengueCurrentSuppressed"] = c["suppressed"]
        region["dengueCurrentYear"] = current_year

        # Summed across both years. Bounds are added as intervals, so a
        # county suppressed twice comes out '2 to 8' rather than a single
        # number that was never reported.
        lo, hi = h["lo"] + c["lo"], h["hi"] + c["hi"]
        region["dengueTotal"] = hi
        region["dengueTotalMin"] = lo
        region["dengueTotalMax"] = hi
        region["dengueTotalLabel"] = format_range(lo, hi)
        region["dengueTotalSuppressed"] = h["suppressed"] or c["suppressed"]
        region["dengueYears"] = sorted(
            y for y in {historic_year, current_year} if y is not None
        )

        if counts is None:
            region["mosquitoObservations"] = None
            region["mosquitoSpecies"] = None
        else:
            region["mosquitoObservations"] = counts[region["id"]]["observations"]
            region["mosquitoSpecies"] = counts[region["id"]]["species"]

        if region["fips"] is None:
            unmatched.append(region["county"])

    # Any CSV county that didn't land on a region means a name mismatch.
    region_keys = {normalize_county(r["county"]) for r in regions}
    for label, table in (("historic", historic), ("current", current)):
        missed = sorted(set(table) - region_keys)
        if missed:
            print(f"warning: {label} dengue rows with no matching region: {missed}")
    if unmatched:
        print(f"warning: no FIPS for: {unmatched}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(regions, indent=2))

    reporting = sum(
        1 for r in regions if r.get("mosquitoObservations")
    )
    print(f"counties with mosquito observations: {reporting}/{len(regions)}")

    with_dengue = sum(1 for r in regions if r["dengueTotal"])
    top = sorted(regions, key=lambda r: r["dengueTotal"], reverse=True)[:5]

    print(f"\nwrote {out}")
    print(f"counties with any dengue cases: {with_dengue}/{len(regions)}")
    print(f"statewide total (upper bound): {sum(r['dengueTotalMax'] for r in regions)}")
    print("highest:")
    for r in top:
        print(f"  {r['county']:<14} {r['dengueTotalLabel']}")


if __name__ == "__main__":
    main()