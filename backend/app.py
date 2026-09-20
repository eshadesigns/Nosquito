import json
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from google import genai
from google.genai import types


# Load variables from the .env file
load_dotenv()


# Create Flask app
app = Flask(__name__)

# Allow your dashboard frontend to communicate with this backend
CORS(app)

# Load the county dataset the map, summary card, and Skeeter all read from
DATA_PATH = Path(__file__).parent / "data" / "regions.json"
with open(DATA_PATH) as f:
    REGIONS = json.load(f)


# Gemini model
MODEL = "gemini-3.6-flash"


# Skeeter's personality
SYSTEM_INSTRUCTION = (
    "You are Skeeter, a helpful and friendly AI assistant. "
    "Give clear, conversational answers. "
    "Keep answers concise unless the user asks for more detail."
)


def get_client():
    """
    Create a Gemini client using the API key stored in .env.
    """

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY was not found. "
            "Make sure it is included in your .env file."
        )

    return genai.Client(api_key=api_key)


@app.route("/api/regions")
def regions():
    """Data for the map, summary card, and details panel."""
    return jsonify(REGIONS)


@app.route("/api/skeeter", methods=["POST"])

def chat():
    """
    Receive conversation history from the dashboard
    and stream Skeeter's response back.
    """

    data = request.get_json(silent=True) or {}
    history = data.get("messages", [])

    if not history:
        return Response(
            "No messages were provided.",
            status=400,
            mimetype="text/plain",
        )

    try:
        client = get_client()

    except RuntimeError as error:
        return Response(
            str(error),
            status=500,
            mimetype="text/plain",
        )

    # Convert dashboard messages into Gemini's format
    contents = []

    for turn in history:
        role = "user" if turn.get("role") == "user" else "model"
        message = turn.get("content", "")

        contents.append(
            types.Content(
                role=role,
                parts=[
                    types.Part(text=message)
                ],
            )
        )

    # Stream Gemini's response
    def generate():
        try:
            stream = client.models.generate_content_stream(
                model=MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.7,
                ),
            )

            for chunk in stream:
                if chunk.text:
                    yield chunk.text

        except Exception as error:
            yield f"\n\n[Error: {error}]"

    return Response(
        stream_with_context(generate()),
        mimetype="text/plain",
    )


@app.route("/api/health", methods=["GET"])
def health():
    """
    Simple endpoint to check whether Skeeter is running.
    """

    return {
        "status": "ok",
        "service": "skeeter",
    }


if __name__ == "__main__":
    app.run(
        debug=True,
        host="0.0.0.0",
        port=5001,
    )