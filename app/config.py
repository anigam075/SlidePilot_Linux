from dataclasses import dataclass
import os

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Settings:
    openai_api_key: str
    openai_model: str
    azure_speech_key: str
    azure_speech_region: str
    azure_speech_voice: str
    storage_root: str


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


settings = Settings(
    openai_api_key=_required("OPENAI_API_KEY"),
    openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
    azure_speech_key=_required("AZURE_SPEECH_KEY"),
    azure_speech_region=_required("AZURE_SPEECH_REGION"),
    azure_speech_voice=os.getenv("AZURE_SPEECH_VOICE", "en-US-JennyNeural"),
    storage_root=os.getenv("STORAGE_ROOT", "data"),
)
