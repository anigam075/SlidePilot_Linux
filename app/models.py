from pydantic import BaseModel


class QnARequest(BaseModel):
    question: str


class SlideInfo(BaseModel):
    slide_number: int
    title: str
    content_text: str
    notes_text: str
    image_url: str | None = None
    script: str | None = None
    audio_url: str | None = None


class DeckResponse(BaseModel):
    deck_id: str
    filename: str
    total_slides: int
    slides: list[SlideInfo]
