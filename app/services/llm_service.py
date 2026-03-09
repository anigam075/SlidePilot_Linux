from __future__ import annotations

import base64
import mimetypes
from pathlib import Path

from openai import OpenAI

from app.config import settings


def _image_data_url(image_path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(image_path))
    if not mime_type:
        mime_type = "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _first_text_choice(completion) -> str:
    content = completion.choices[0].message.content
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks = []
        for item in content:
            if getattr(item, "type", None) == "text":
                chunks.append(getattr(item, "text", ""))
        return "\n".join(chunk for chunk in chunks if chunk).strip()
    return ""


def _normalize_slide_opening(text: str) -> str:
    clean = text.strip()
    if not clean:
        return clean
    if clean.lower().startswith("in this slide"):
        return clean
    lead = clean[0].lower() + clean[1:] if clean[0].isupper() else clean
    return f"In this slide, {lead}"


class LLMService:
    def __init__(self) -> None:
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model

    def build_slide_script(
        self,
        title: str,
        content_text: str,
        notes_text: str,
        image_path: Path | None = None,
    ) -> str:
        user_content: list[dict] = [
            {
                "type": "text",
                "text": (
                    "Generate spoken narration for one presentation slide.\n"
                    "Rules:\n"
                    "- 90-160 words\n"
                    "- Natural, clear speaking style\n"
                    "- Prioritize factual accuracy from extracted text and notes\n"
                    "- Use the slide image to interpret charts/diagrams/layout\n"
                    "- If image and extracted text conflict, prefer extracted text for exact facts\n"
                    "- If content is sparse, describe likely visual takeaway without inventing numbers\n"
                    "- No bullet list formatting\n\n"
                    "- Start with 'In this slide,' and avoid openings like 'Today we are discussing'\n\n"
                    f"Slide title: {title}\n\n"
                    f"Extracted slide text:\n{content_text or '[empty]'}\n\n"
                    f"Speaker notes:\n{notes_text or '[none]'}"
                ),
            }
        ]
        if image_path and image_path.exists():
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": _image_data_url(image_path)},
                }
            )

        completion = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert presentation narrator. Combine textual and visual slide context "
                        "to produce accurate, listener-friendly narration."
                    ),
                },
                {"role": "user", "content": user_content},
            ],
        )
        text = _first_text_choice(completion)
        if not text:
            text = "This slide appears to be mostly visual. Please review the key chart or image details."
        return _normalize_slide_opening(text)

    def answer_question(
        self,
        question: str,
        current_slide: dict,
        previous_slides: list[dict],
        image_path: Path | None = None,
    ) -> str:
        previous_context = "\n\n".join(
            [
                f"Slide {s['slide_number']} ({s['title']}):\n"
                f"Text: {s.get('content_text') or '[none]'}\n"
                f"Narration: {s.get('script') or '[none]'}"
                for s in previous_slides
            ]
        )
        text_context = (
            f"Current slide {current_slide['slide_number']} - {current_slide['title']}\n"
            f"Extracted text:\n{current_slide.get('content_text', '') or '[empty]'}\n\n"
            f"Speaker notes:\n{current_slide.get('notes_text', '') or '[none]'}\n\n"
            f"Current narration:\n{current_slide.get('script', '') or '[none]'}\n\n"
            f"Previous slides context:\n{previous_context or '[none]'}\n\n"
            f"User question:\n{question}"
        )

        user_content: list[dict] = [{"type": "text", "text": text_context}]
        if image_path and image_path.exists():
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": _image_data_url(image_path)},
                }
            )

        completion = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a slide QnA assistant. Answer only from provided context and slide image. "
                        "If uncertain or missing details, say so explicitly."
                    ),
                },
                {"role": "user", "content": user_content},
            ],
        )
        text = _first_text_choice(completion)
        return text or "I could not find enough reliable context in this slide to answer that."

    def answer_deck_question(self, question: str, slides: list[dict]) -> str:
        deck_context = "\n\n".join(
            [
                f"Slide {s['slide_number']} - {s['title']}\n"
                f"Text: {s.get('content_text') or '[none]'}\n"
                f"Notes: {s.get('notes_text') or '[none]'}\n"
                f"Narration: {s.get('script') or '[none]'}"
                for s in slides
            ]
        )
        completion = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a presentation QnA assistant. Answer questions using the full deck context. "
                        "If the deck context is insufficient, say that clearly."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Deck context:\n{deck_context or '[none]'}\n\n"
                        f"Question:\n{question}"
                    ),
                },
            ],
        )
        text = _first_text_choice(completion)
        return text or "I could not find enough reliable context in this presentation to answer that."
