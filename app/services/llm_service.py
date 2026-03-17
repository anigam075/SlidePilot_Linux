from __future__ import annotations

import base64
import json
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


def _deck_context(slides: list[dict]) -> str:
    return "\n\n".join(
        [
            f"Slide {s['slide_number']} - {s['title']}\n"
            f"Text: {s.get('content_text') or '[none]'}\n"
            f"Notes: {s.get('notes_text') or '[none]'}"
            for s in slides
        ]
    )


def _safe_excerpt(text: str | None, limit: int = 220) -> str:
    if not text:
        return "[none]"
    clean = " ".join(text.split())
    return clean[:limit]


class LLMService:
    def __init__(self) -> None:
        self.client = OpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model

    def build_deck_brief(self, slides: list[dict]) -> str:
        completion = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are helping prepare a human-like presentation. Produce a concise deck brief "
                        "that captures the storyline and speaker intent."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Create a compact presenter brief for this deck.\n"
                        "Include:\n"
                        "- overall topic\n"
                        "- audience-facing objective\n"
                        "- 3 to 5 key themes\n"
                        "- a one-line storyline arc across the deck\n"
                        "- one short role statement for each slide\n"
                        "Keep it concise and factual.\n\n"
                        f"Deck context:\n{_deck_context(slides) or '[none]'}"
                    ),
                },
            ],
        )
        text = _first_text_choice(completion)
        return (
            text
            or "Topic: presentation overview. Objective: explain the main ideas clearly. Storyline: introduce the topic, walk through key points, and close with takeaways."
        )

    def build_slide_script(
        self,
        title: str,
        content_text: str,
        notes_text: str,
        image_path: Path | None = None,
        deck_brief: str | None = None,
        previous_slide_title: str | None = None,
        previous_script: str | None = None,
        next_slide_title: str | None = None,
        slide_position: str = "middle",
    ) -> str:
        continuity_context = (
            f"Deck brief:\n{deck_brief or '[none]'}\n\n"
            f"Previous slide title: {previous_slide_title or '[none]'}\n"
            f"Previous narration excerpt: {_safe_excerpt(previous_script)}\n"
            f"Next slide title: {next_slide_title or '[none]'}\n"
            f"Current slide position: {slide_position}"
        )
        user_content: list[dict] = [
            {
                "type": "text",
                "text": (
                    "Generate spoken narration for one presentation slide.\n"
                    "Rules:\n"
                    "- 85-150 words\n"
                    "- Speak like a human presenter addressing an audience, not like a slide-captioning tool\n"
                    "- Prioritize factual accuracy from extracted text and notes\n"
                    "- Use the slide image only to support interpretation of business visuals like charts, diagrams, or screenshots\n"
                    "- If image and extracted text conflict, prefer extracted text for exact facts\n"
                    "- Never speculate about blank space, generic layouts, or vague design meaning\n"
                    "- If content is sparse, explain the role of this slide in the presentation storyline instead of guessing what the image means\n"
                    "- No bullet list formatting\n"
                    "- Create continuity from the previous slide and, where natural, set up the next slide\n"
                    "- Use a presenter flow: transition, explanation, takeaway\n"
                    "- Avoid formulaic transition starters such as 'As we delve deeper', 'As we dive', 'As we continue', 'As we transition', 'As we move forward', or 'As we wrap up'\n"
                    "- Prefer simple, human openings with variety: sometimes direct, sometimes contextual, sometimes takeaway-first\n"
                    "- Do not use the same sentence pattern repeatedly across slides\n"
                    "- Avoid starting with phrases like 'This image shows' unless the slide is explicitly about reading a visual\n"
                    "- For the first slide, continue naturally after the opening summary and do not repeat salutations like hello everyone or welcome everyone\n"
                    "- For middle slides, transition naturally from what was just covered\n"
                    "- For late slides, sound like the presentation is progressing toward a conclusion\n\n"
                    f"{continuity_context}\n\n"
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
                        "to produce accurate, listener-friendly narration that sounds like a real presenter."
                    ),
                },
                {"role": "user", "content": user_content},
            ],
        )
        text = _first_text_choice(completion)
        if not text:
            text = "This part of the presentation highlights an important point that connects to the broader discussion."
        return text.strip()

    def build_deck_intro_summary(self, slides: list[dict]) -> str:
        deck_brief = self.build_deck_brief(slides)
        completion = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a presentation host. Write a concise opening summary for the whole deck, "
                        "in a natural spoken style."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Generate a short opening summary before slide narration starts.\n"
                        "Rules:\n"
                        "- 45-85 words\n"
                        "- Explain what this presentation is about\n"
                        "- Mention 2-3 key themes at high level\n"
                        "- Sound human and welcoming\n- You may use one light salutation like hello everyone or welcome everyone here\n- Do not use greetings like good morning, good afternoon, or good evening\n"
                        "- No bullet points\n\n"
                        f"Presenter brief:\n{deck_brief}\n\n"
                        f"Deck context:\n{_deck_context(slides) or '[none]'}"
                    ),
                },
            ],
        )
        text = _first_text_choice(completion)
        return text or "Welcome. This presentation gives a quick overview of the key topics covered in this deck."

    def build_deck_conclusion_summary(self, slides: list[dict]) -> str:
        deck_brief = self.build_deck_brief(slides)
        completion = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a presentation host. Write a concise closing summary for the whole deck, "
                        "in a natural spoken style."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Generate a short conclusion summary after the final slide and before QnA.\n"
                        "Rules:\n"
                        "- 45-95 words\n"
                        "- Recap key takeaways\n"
                        "- End by inviting questions\n"
                        "- Sound natural and confident\n- Do not use greetings like good morning, good afternoon, or good evening\n"
                        "- No bullet points\n\n"
                        f"Presenter brief:\n{deck_brief}\n\n"
                        f"Deck context:\n{_deck_context(slides) or '[none]'}"
                    ),
                },
            ],
        )
        text = _first_text_choice(completion)
        return (
            text
            or "That concludes the presentation and its key takeaways. If you have any questions, feel free to ask in the QnA section."
        )

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
        return self.answer_deck_question_with_reference(question, slides)["answer"]

    def answer_deck_question_with_reference(self, question: str, slides: list[dict]) -> dict:
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
                        "Classify whether the answer is anchored to one specific slide, multiple slides, or the full deck. "
                        "Return strict JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "Use the full deck context to answer the question.\n"
                        "Return JSON with exactly these keys:\n"
                        "answer_scope: one of single_slide, multi_slide, deck_level\n"
                        "primary_slide_number: integer slide number or null\n"
                        "answer: concise spoken answer grounded in the deck\n"
                        "Rules:\n"
                        "- Use single_slide only when one slide is clearly the best reference\n"
                        "- Use multi_slide when multiple slides are needed\n"
                        "- Use deck_level when the answer is about the overall presentation\n"
                        "- If answer_scope is single_slide, the answer may naturally reference that slide with phrases like 'on this slide' or 'as you can see here'\n"
                        "- If answer_scope is multi_slide or deck_level, do not pretend one visible slide is enough\n"
                        "- Do not include markdown fences or extra commentary\n\n"
                        f"Deck context:\n{deck_context or '[none]'}\n\n"
                        f"Question:\n{question}"
                    ),
                },
            ],
        )
        text = _first_text_choice(completion)
        fallback = {
            "answer_scope": "deck_level",
            "primary_slide_number": None,
            "answer": "I could not find enough reliable context in this presentation to answer that.",
        }
        if not text:
            return fallback
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return {
                "answer_scope": "deck_level",
                "primary_slide_number": None,
                "answer": text,
            }

        answer_scope = str(payload.get("answer_scope") or "deck_level").strip()
        if answer_scope not in {"single_slide", "multi_slide", "deck_level"}:
            answer_scope = "deck_level"
        primary_slide_number = payload.get("primary_slide_number")
        if answer_scope != "single_slide":
            primary_slide_number = None
        else:
            try:
                primary_slide_number = int(primary_slide_number)
            except (TypeError, ValueError):
                answer_scope = "deck_level"
                primary_slide_number = None

        answer = str(payload.get("answer") or "").strip() or fallback["answer"]
        return {
            "answer_scope": answer_scope,
            "primary_slide_number": primary_slide_number,
            "answer": answer,
        }
