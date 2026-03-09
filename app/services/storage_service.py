from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4


class StorageService:
    def __init__(self, root: str) -> None:
        self.root = Path(root)
        self.uploads_dir = self.root / "uploads"
        self.decks_dir = self.root / "decks"
        self.audio_dir = self.root / "audio"
        self.images_dir = self.root / "images"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.decks_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)

    def new_deck_id(self) -> str:
        return uuid4().hex

    def deck_upload_path(self, deck_id: str, original_filename: str) -> Path:
        clean_name = Path(original_filename).name
        return self.uploads_dir / f"{deck_id}_{clean_name}"

    def deck_json_path(self, deck_id: str) -> Path:
        return self.decks_dir / f"{deck_id}.json"

    def slide_audio_path(self, deck_id: str, slide_number: int) -> Path:
        deck_audio_dir = self.audio_dir / deck_id
        deck_audio_dir.mkdir(parents=True, exist_ok=True)
        return deck_audio_dir / f"slide_{slide_number}.wav"

    def qna_audio_path(self, deck_id: str, slide_number: int) -> Path:
        deck_audio_dir = self.audio_dir / deck_id
        deck_audio_dir.mkdir(parents=True, exist_ok=True)
        return deck_audio_dir / f"qna_slide_{slide_number}_{uuid4().hex[:8]}.wav"

    def deck_images_dir(self, deck_id: str) -> Path:
        images_dir = self.images_dir / deck_id
        images_dir.mkdir(parents=True, exist_ok=True)
        return images_dir

    def closing_audio_path(self, deck_id: str) -> Path:
        deck_audio_dir = self.audio_dir / deck_id
        deck_audio_dir.mkdir(parents=True, exist_ok=True)
        return deck_audio_dir / "closing_statement.wav"

    def save_deck(self, deck_id: str, data: dict[str, Any]) -> None:
        path = self.deck_json_path(deck_id)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def load_deck(self, deck_id: str) -> dict[str, Any] | None:
        path = self.deck_json_path(deck_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
