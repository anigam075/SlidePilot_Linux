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
    render_warning: str | None = None
    intro_summary: str | None = None
    intro_audio_url: str | None = None
    conclusion_summary: str | None = None
    conclusion_audio_url: str | None = None
    closing_statement: str | None = None
    closing_audio_url: str | None = None


class DeckQnAResponse(BaseModel):
    answer: str
    audio_url: str
    answer_scope: str
    primary_slide_number: int | None = None
    context_notice: str | None = None
