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
    """Reads GLOBE Observer mosquito habitat mapper data for a date range, limited to Florida."""

    _BASE_URL = "https://api.globe.gov/search/v1/measurement/"
    _PROTOCOL = "mosquito_habitat_mapper"

    # GLOBE's API has no state-level filter, so Florida measurements are
    # approximated with this bounding box after fetching.
    _FLORIDA_BOUNDS = {
        "min_lat": 24.396308,
        "max_lat": 31.000968,
        "min_lon": -87.634896,
        "max_lon": -79.974307,
    }

    def __init__(self, start_date: date = date(2025, 6, 1), end_date: date = date(2025, 8, 31)):
        self.start_date = start_date
        self.end_date = end_date or date.today()
        self._data = self._fetch_data()

    def set_date_range(self, start_date: date, end_date: date) -> None:
        """Update the date range and re-fetch the population data."""
        self.start_date = start_date
        self.end_date = end_date
        self._data = self._fetch_data()

    def get_populations(self) -> gpd.GeoDataFrame:
        """Return the Florida mosquito measurements for the current date range."""
        return self._data

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
        return self._filter_to_florida(data)

    def _filter_to_florida(self, data: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
        bounds = self._FLORIDA_BOUNDS
        return data.cx[bounds["min_lon"]:bounds["max_lon"], bounds["min_lat"]:bounds["max_lat"]]


# Jsut for testing for now :

if __name__ == '__main__': 

    mp = MosquitoPopulation()
    print(mp._fetch_data())
