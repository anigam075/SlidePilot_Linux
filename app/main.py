from __future__ import annotations

import shutil
from pathlib import Path
import re
import logging

import httpx
from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.models import DeckResponse, QnARequest
from app.services.llm_service import LLMService
from app.services.ppt_service import parse_pptx
from app.services.slide_render_service import render_pptx_to_images
from app.services.speech_service import SpeechService
from app.services.storage_service import StorageService


BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"


app = FastAPI(title="SlidePilot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

storage = StorageService(settings.storage_root)
llm_service = LLMService()
speech_service = SpeechService()
logger = logging.getLogger("slidepilot.voice")


def _load_deck_or_404(deck_id: str) -> dict:
    deck = storage.load_deck(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    return deck


def _find_slide(deck: dict, slide_number: int) -> dict:
    for slide in deck["slides"]:
        if slide["slide_number"] == slide_number:
            return slide
    raise HTTPException(status_code=404, detail="Slide not found")


def _slide_image_path(deck_id: str, slide: dict) -> Path | None:
    image_url = slide.get("image_url")
    if not image_url:
        return None
    filename = image_url.rstrip("/").split("/")[-1]
    path = storage.images_dir / deck_id / filename
    return path if path.exists() else None


def _deck_intro_audio_path(deck_id: str) -> Path:
    deck_audio_dir = storage.audio_dir / deck_id
    deck_audio_dir.mkdir(parents=True, exist_ok=True)
    return deck_audio_dir / "intro_summary.wav"


def _deck_conclusion_audio_path(deck_id: str) -> Path:
    deck_audio_dir = storage.audio_dir / deck_id
    deck_audio_dir.mkdir(parents=True, exist_ok=True)
    return deck_audio_dir / "conclusion_summary.wav"


def _slide_position(index: int, total_slides: int) -> str:
    if index == 0:
        return "first"
    if index == total_slides - 1:
        return "last"
    if index >= max(total_slides - 2, 1):
        return "late"
    return "middle"


@app.get("/")
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/player/{deck_id}")
async def player_page(request: Request, deck_id: str):
    _load_deck_or_404(deck_id)
    return templates.TemplateResponse(
        "player.html",
        {"request": request, "deck_id": deck_id},
    )


@app.post("/api/upload", response_model=DeckResponse)
async def upload_ppt(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        raise HTTPException(status_code=400, detail="Only .pptx files are supported")

    deck_id = storage.new_deck_id()
    upload_path = storage.deck_upload_path(deck_id, file.filename)
    with upload_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    slides = await run_in_threadpool(parse_pptx, upload_path)
    if not slides:
        raise HTTPException(status_code=400, detail="No slides found in the uploaded file")

    render_warning = None
    try:
        images_dir = storage.deck_images_dir(deck_id)
        image_paths = await run_in_threadpool(render_pptx_to_images, upload_path, images_dir)
        image_by_number = {}
        for image_path in image_paths:
            name = image_path.stem
            match = re.search(r"(\d+)$", name)
            if match:
                image_by_number[int(match.group(1))] = image_path.name
        for slide in slides:
            filename = image_by_number.get(slide["slide_number"])
            if filename:
                slide["image_url"] = f"/api/images/{deck_id}/{filename}"
    except Exception as exc:
        render_warning = str(exc)

    deck = {
        "deck_id": deck_id,
        "filename": file.filename,
        "upload_path": str(upload_path),
        "total_slides": len(slides),
        "slides": slides,
        "render_warning": render_warning,
    }
    storage.save_deck(deck_id, deck)
    return deck


@app.get("/api/decks/{deck_id}", response_model=DeckResponse)
async def get_deck(deck_id: str):
    return _load_deck_or_404(deck_id)


@app.post("/api/decks/{deck_id}/prepare")
async def prepare_deck_narration(deck_id: str):
    deck = _load_deck_or_404(deck_id)
    slides = deck["slides"]

    if not deck.get("deck_brief"):
        deck["deck_brief"] = await run_in_threadpool(llm_service.build_deck_brief, slides)

    total_slides = len(slides)
    for idx, slide in enumerate(slides):
        slide_number = slide["slide_number"]
        if not slide.get("script"):
            image_path = _slide_image_path(deck_id, slide)
            previous_slide = slides[idx - 1] if idx > 0 else None
            next_slide = slides[idx + 1] if idx < total_slides - 1 else None
            slide["script"] = await run_in_threadpool(
                llm_service.build_slide_script,
                slide["title"],
                slide["content_text"],
                slide["notes_text"],
                image_path,
                deck["deck_brief"],
                previous_slide["title"] if previous_slide else None,
                previous_slide.get("script") if previous_slide else None,
                next_slide["title"] if next_slide else None,
                _slide_position(idx, total_slides),
            )

        audio_path = storage.slide_audio_path(deck_id, slide_number)
        if not audio_path.exists():
            await run_in_threadpool(speech_service.synthesize_to_file, slide["script"], audio_path)
        slide["audio_url"] = f"/api/audio/{deck_id}/{audio_path.name}"

    if not deck.get("intro_summary"):
        deck["intro_summary"] = await run_in_threadpool(llm_service.build_deck_intro_summary, slides)
    intro_audio_path = _deck_intro_audio_path(deck_id)
    if not intro_audio_path.exists():
        await run_in_threadpool(speech_service.synthesize_to_file, deck["intro_summary"], intro_audio_path)
    deck["intro_audio_url"] = f"/api/audio/{deck_id}/{intro_audio_path.name}"

    if not deck.get("conclusion_summary"):
        deck["conclusion_summary"] = await run_in_threadpool(llm_service.build_deck_conclusion_summary, slides)
    conclusion_audio_path = _deck_conclusion_audio_path(deck_id)
    if not conclusion_audio_path.exists():
        await run_in_threadpool(
            speech_service.synthesize_to_file,
            deck["conclusion_summary"],
            conclusion_audio_path,
        )
    deck["conclusion_audio_url"] = f"/api/audio/{deck_id}/{conclusion_audio_path.name}"

    deck["closing_statement"] = deck["conclusion_summary"]
    deck["closing_audio_url"] = deck["conclusion_audio_url"]

    storage.save_deck(deck_id, deck)

    return {
        "deck_id": deck_id,
        "total_slides": deck["total_slides"],
        "slides": deck["slides"],
        "intro_summary": deck["intro_summary"],
        "intro_audio_url": deck["intro_audio_url"],
        "conclusion_summary": deck["conclusion_summary"],
        "conclusion_audio_url": deck["conclusion_audio_url"],
        "closing_statement": deck["closing_statement"],
        "closing_audio_url": deck["closing_audio_url"],
    }


@app.post("/api/decks/{deck_id}/slides/{slide_number}/narrate")
async def narrate_slide(deck_id: str, slide_number: int):
    deck = _load_deck_or_404(deck_id)
    slide = _find_slide(deck, slide_number)

    if not slide.get("script"):
        image_path = _slide_image_path(deck_id, slide)
        previous = [s for s in deck["slides"] if s["slide_number"] < slide_number]
        previous_slide = previous[-1] if previous else None
        next_slide = next((s for s in deck["slides"] if s["slide_number"] > slide_number), None)
        slide["script"] = await run_in_threadpool(
            llm_service.build_slide_script,
            slide["title"],
            slide["content_text"],
            slide["notes_text"],
            image_path,
            deck.get("deck_brief"),
            previous_slide["title"] if previous_slide else None,
            previous_slide.get("script") if previous_slide else None,
            next_slide["title"] if next_slide else None,
            "middle",
        )

    audio_path = storage.slide_audio_path(deck_id, slide_number)
    await run_in_threadpool(speech_service.synthesize_to_file, slide["script"], audio_path)
    slide["audio_url"] = f"/api/audio/{deck_id}/{audio_path.name}"

    storage.save_deck(deck_id, deck)
    return {
        "deck_id": deck_id,
        "slide_number": slide_number,
        "title": slide["title"],
        "script": slide["script"],
        "audio_url": slide["audio_url"],
    }


@app.post("/api/decks/{deck_id}/slides/{slide_number}/qna")
async def slide_qna(deck_id: str, slide_number: int, body: QnARequest):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    deck = _load_deck_or_404(deck_id)
    slide = _find_slide(deck, slide_number)
    previous = [s for s in deck["slides"] if s["slide_number"] < slide_number]
    image_path = _slide_image_path(deck_id, slide)
    answer = await run_in_threadpool(
        llm_service.answer_question,
        question,
        slide,
        previous,
        image_path,
    )
    qna_audio_path = storage.qna_audio_path(deck_id, slide_number)
    await run_in_threadpool(speech_service.synthesize_to_file, answer, qna_audio_path)
    return {
        "answer": answer,
        "audio_url": f"/api/audio/{deck_id}/{qna_audio_path.name}",
    }


@app.post("/api/decks/{deck_id}/qna")
async def deck_qna(deck_id: str, body: QnARequest):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    deck = _load_deck_or_404(deck_id)
    answer = await run_in_threadpool(llm_service.answer_deck_question, question, deck["slides"])
    qna_audio_path = storage.qna_audio_path(deck_id, 0)
    await run_in_threadpool(speech_service.synthesize_to_file, answer, qna_audio_path)
    return {
        "answer": answer,
        "audio_url": f"/api/audio/{deck_id}/{qna_audio_path.name}",
    }


@app.get("/api/audio/{deck_id}/{filename}")
async def get_audio(deck_id: str, filename: str):
    path = storage.audio_dir / deck_id / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(path, media_type="audio/wav")


@app.get("/api/images/{deck_id}/{filename}")
async def get_image(deck_id: str, filename: str):
    path = storage.images_dir / deck_id / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


@app.get("/api/speech/token")
async def get_speech_token():
    url = f"https://{settings.azure_speech_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    headers = {"Ocp-Apim-Subscription-Key": settings.azure_speech_key}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(url, headers=headers)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to connect to Azure Speech token service") from exc

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch Azure Speech token")

    return {"token": response.text, "region": settings.azure_speech_region}


@app.post("/api/voice/debug")
async def voice_debug(payload: dict = Body(...)):
    text = str(payload.get("text", "")).strip()
    if text:
        print(f"[SlidePilot Voice Debug] {text}", flush=True)
        logger.info("Voice recognized: %s", text)
    return {"ok": True}


from fastapi.responses import HTMLResponse


@app.get("/api/test", response_class=HTMLResponse)
async def test():
    return """
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.chat("Explain quantum computing in simple terms", {model: 'claude-sonnet-4-6'})
            .then(response => {
                puter.print(response.message.content[0].text);
            });
    </script>
</body>
</html>
    """
