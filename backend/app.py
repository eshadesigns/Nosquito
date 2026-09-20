"""
NoSquito backend — API only.

This serves no HTML; the frontend (in ../frontend) is a separate Vite dev server
that talks to this over /api/* (proxied in dev, see frontend/vite.config.js).

Setup:
    pip install -r requirements.txt
    export GEMINI_API_KEY="your-api-key-here"   # (on Windows: set GEMINI_API_KEY=your-key)

Run:
    python app.py
    (listens on http://127.0.0.1:5000)
"""

import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from google import genai
from google.genai import types

app = Flask(__name__)
CORS(app)  # allow the Vite dev server (a different port) to call this API

MODEL = "gemini-3.6-flash"  # check ai.google.dev/gemini-api/docs/models for a higher-quality option if needed

DATA_PATH = Path(__file__).parent / "data" / "regions.json"
with open(DATA_PATH) as f:
    REGIONS = json.load(f)
REGIONS_BY_ID = {r["id"]: r for r in REGIONS}

BASE_SYSTEM_INSTRUCTION = """You are Skeeter, the data assistant built into NoSquito, a Florida mosquito \
treatment dashboard. Answer only using the Florida county dataset below — treatment \
priority, mosquito activity, habitat risk, rainfall, temperature, treatment status, \
expected treatment effectiveness, confidence, and the reasons behind each county's \
priority. Keep answers short and concrete, and ground every claim in the numbers \
given rather than general mosquito knowledge. This is demo data for a hackathon \
prototype, not real current treatment data — say so if it's relevant to the question. \
If something is asked that the dataset can't answer, say that plainly instead of \
guessing.

DATASET (one row per county):
{dataset_summary}
"""


def dataset_summary() -> str:
    lines = []
    for r in REGIONS:
        line = (
            f"- {r['county']} County: priority={r['priority']}, "
            f"mosquitoActivity={r['mosquitoActivity']}/100, habitatRisk={r['habitatRisk']}/100, "
            f"rainfall={r['rainfall']}in, temperature={r['temperature']}F, "
            f"treatmentStatus=\"{r['treatmentStatus']}\", "
            f"treatmentEffectiveness={r['treatmentEffectiveness']}%, confidence={r['confidence']}, "
            f"lastUpdated=\"{r['lastUpdated']}\", reasons={r['reasons']}"
        )
        if r.get("changeNote"):
            line += f", changeNote=\"{r['changeNote']}\""
        lines.append(line)
    return "\n".join(lines)


def get_client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set.")
    return genai.Client(api_key=api_key)


@app.route("/api/regions")
def regions():
    """Single source of truth for the map, summary card, details panel, and Skeeter."""
    return jsonify(REGIONS)


@app.route("/api/skeeter", methods=["POST"])
def skeeter():
    data = request.get_json(force=True) or {}
    history = data.get("messages", [])  # [{role: "user"|"model", content: str}, ...]
    selected_id = data.get("selectedId")

    try:
        client = get_client()
    except RuntimeError as e:
        return Response(str(e), status=500, mimetype="text/plain")

    system_instruction = BASE_SYSTEM_INSTRUCTION.format(dataset_summary=dataset_summary())
    selected = REGIONS_BY_ID.get(selected_id)
    if selected:
        system_instruction += (
            f"\n\nThe user currently has {selected['county']} County selected on the "
            f"map. If their question doesn't name a different county, assume they mean "
            f"{selected['county']} County."
        )

    contents = [
        types.Content(
            role="user" if turn.get("role") == "user" else "model",
            parts=[types.Part(text=turn.get("content", ""))],
        )
        for turn in history
    ]

    def generate():
        try:
            stream = client.models.generate_content_stream(
                model=MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.4,
                ),
            )
            for chunk in stream:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            yield f"\n\n[Error: {e}]"

    return Response(stream_with_context(generate()), mimetype="text/plain")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
