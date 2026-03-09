from __future__ import annotations

from pathlib import Path

import azure.cognitiveservices.speech as speechsdk

from app.config import settings


class SpeechService:
    def __init__(self) -> None:
        self.speech_config = speechsdk.SpeechConfig(
            subscription=settings.azure_speech_key,
            region=settings.azure_speech_region,
        )
        self.speech_config.speech_synthesis_voice_name = settings.azure_speech_voice

    def synthesize_to_file(self, text: str, output_path: Path) -> None:
        audio_config = speechsdk.audio.AudioOutputConfig(filename=str(output_path))
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self.speech_config,
            audio_config=audio_config,
        )
        result = synthesizer.speak_text_async(text).get()
        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            details = ""
            if result.reason == speechsdk.ResultReason.Canceled:
                cancellation = speechsdk.SpeechSynthesisCancellationDetails.from_result(result)
                details = f" ({cancellation.reason}: {cancellation.error_details})"
            raise RuntimeError(f"Speech synthesis failed{details}")
