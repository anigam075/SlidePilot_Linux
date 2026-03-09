# SlidePilot

SlidePilot is an AI-powered web app that turns PPTX decks into auto-narrated, slide-by-slide presentations with voice playback, visual-aware narration, and end-of-deck Q&A.

## Features
- Upload `.pptx` files directly from the browser
- Extract slide text and speaker notes
- Render slide images for visual context (Windows + PowerPoint)
- Generate narration using OpenAI (text + slide image context)
- Convert narration and answers to speech using Azure AI Speech
- Auto-play full presentation with:
  - pre-generated narration for all slides (reduced pauses)
  - pause/play and replay controls
- Ask questions at the end using full-deck context (text + voice answer)

## Tech Stack
- Backend: FastAPI
- Frontend: HTML, CSS, JavaScript
- LLM/Vision: OpenAI API
- TTS: Azure AI Speech
- PPT parsing: `python-pptx`
- Slide rendering: PowerPoint COM automation (`comtypes` / `pywin32`)
- Storage: local disk (`data/`)

## Prerequisites
- Python 3.10+ (project tested with Python 3.12)
- Windows machine (for slide image rendering)
- Microsoft PowerPoint installed locally
- OpenAI API key
- Azure AI Speech key + region

## Environment Variables
Create a `.env` file:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
AZURE_SPEECH_VOICE=en-US-JennyNeural
```

## Installation
```powershell
python -m venv env
.\env\Scripts\activate
pip install -r requirements.txt
```

## Run
```powershell
uvicorn app.main:app --reload
```

Open: `http://127.0.0.1:8000`

## Usage Flow
1. Upload a `.pptx` deck.
2. Click **Start Presentation**.
3. SlidePilot pre-generates narration for all slides.
4. Slides auto-play with voice narration.
5. Ask questions in Q&A (voice + text response).

## API Endpoints
- `POST /api/upload`
- `GET /api/decks/{deck_id}`
- `POST /api/decks/{deck_id}/prepare`
- `POST /api/decks/{deck_id}/slides/{slide_number}/narrate`
- `POST /api/decks/{deck_id}/slides/{slide_number}/qna`
- `POST /api/decks/{deck_id}/qna`
- `GET /api/audio/{deck_id}/{filename}`
- `GET /api/images/{deck_id}/{filename}`

## Notes
- `.ppt` is not supported directly (upload `.pptx`).
- If PowerPoint image export fails, presentation still works with text/notes.
- Runtime-generated files are saved under `data/`."# SlidePilot" 
