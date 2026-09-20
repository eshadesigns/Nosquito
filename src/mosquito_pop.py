import json                                   # For loading the county lookup table
from pathlib import Path                      # For locating the county lookup table on disk
import pandas as pd                           # For working with data
pd.set_option("display.max_columns", None)    # Lets us see all columns of the data instead of just a preview
import geopandas as gpd                       # For working with spatial data
import numpy as np                            # For working with numbers
import matplotlib.pyplot as plt               # For making graphs
from datetime import date                     # For formatting dates
from PIL import Image                         # For getting and displaying images from links
import requests                               # For getting information from links
from io import BytesIO                        # For working with types of input and output


class MosquitoPopulation:
    """Reads GLOBE Observer mosquito habitat mapper data for a date range, split by Florida county."""

    _BASE_URL = "https://api.globe.gov/search/v1/measurement/"
    _PROTOCOL = "mosquito_habitat_mapper"

    # The counties (and their id/lat/long) tracked by the treatment dashboard.
    _COUNTIES_PATH = Path(__file__).resolve().parents[1] / "backend" / "data" / "regions.json"

    def __init__(self, start_date: date = date(2025, 1, 1), end_date: date = date(2026, 1, 1)):
        self.start_date = start_date
        self.end_date = end_date or date.today()
        self._counties = self._load_counties()
        self._data = self._fetch_data()

    def set_date_range(self, start_date: date, end_date: date) -> None:
        """Update the date range and re-fetch the population data."""
        self.start_date = start_date
        self.end_date = end_date
        self._data = self._fetch_data()

    def get_populations(self) -> gpd.GeoDataFrame:
        """Return mosquito measurements for the current date range, each labeled with its county."""
        return self._data

    def get_population_by_county(self, county_name: str) -> gpd.GeoDataFrame:
        """Return measurements for a single county, matched by name (case-insensitive) via regions.json."""
        county_id = self._counties.get(county_name.casefold(), {}).get("id")
        if county_id is None:
            raise ValueError(f"'{county_name}' is not a county tracked in {self._COUNTIES_PATH.name}")
        return self._data[self._data["county_id"] == county_id]

    def _load_counties(self) -> dict:
        with open(self._COUNTIES_PATH) as f:
            regions = json.load(f)
        return {r["county"].casefold(): r for r in regions}

    def _fetch_data(self) -> gpd.GeoDataFrame:
        print("Reading mosquito data...")
        url = (
            f"{self._BASE_URL}?protocols={self._PROTOCOL}"
            f"&datefield=measuredDate"
            f"&startdate={self.start_date.isoformat()}"
            f"&enddate={self.end_date.isoformat()}"
            f"&geojson=TRUE&sample=FALSE"
        )
        data = gpd.read_file(url)
        return self._assign_counties(data)

    # regions.json only has one lat/long point per county (no boundary
    # polygons), so each measurement is assigned to its nearest county
    # centroid rather than matched against an exact county boundary.
    def _assign_counties(self, data: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        counties = list(self._counties.values())
        county_lats = np.array([c["latitude"] for c in counties])
        county_lons = np.array([c["longitude"] for c in counties])

        point_lats = data.geometry.y.to_numpy()
        point_lons = data.geometry.x.to_numpy()

        dist2 = (
            (point_lats[:, None] - county_lats[None, :]) ** 2
            + (point_lons[:, None] - county_lons[None, :]) ** 2
        )
        nearest = dist2.argmin(axis=1)

        data = data.copy()
        data["county"] = [counties[i]["county"] for i in nearest]
        data["county_id"] = [counties[i]["id"] for i in nearest]
        return data


# Jsut for testing for now :

if __name__ == '__main__': 

    mp = MosquitoPopulation()
    print(mp._fetch_data())
