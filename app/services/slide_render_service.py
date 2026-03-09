from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
from typing import Callable


def _collect_slide_images(output_dir: Path) -> list[Path]:
    images = sorted(output_dir.glob("Slide*.*"))
    return [p for p in images if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]


def _clear_old_images(output_dir: Path) -> None:
    for pattern in ("*.png", "*.PNG", "*.jpg", "*.JPG", "*.jpeg", "*.JPEG"):
        for existing in output_dir.glob(pattern):
            existing.unlink(missing_ok=True)


def _render_with_comtypes(pptx_path: Path, output_dir: Path) -> list[Path]:
    try:
        import comtypes.client  # type: ignore
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc

    powerpoint = None
    presentation = None
    try:
        powerpoint = comtypes.client.CreateObject("PowerPoint.Application")
        powerpoint.Visible = 1
        presentation = powerpoint.Presentations.Open(str(pptx_path.resolve()))
        # 17 = ppSaveAsJPG
        presentation.SaveAs(str(output_dir.resolve()), 17)
    finally:
        if presentation is not None:
            presentation.Close()
        if powerpoint is not None:
            powerpoint.Quit()

    images = _collect_slide_images(output_dir)
    if images:
        return images
    raise RuntimeError("No slide images were produced")


def _render_with_win32com(pptx_path: Path, output_dir: Path) -> list[Path]:
    try:
        import win32com.client  # type: ignore
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc

    powerpoint = None
    presentation = None
    try:
        powerpoint = win32com.client.Dispatch("PowerPoint.Application")
        powerpoint.Visible = 1
        presentation = powerpoint.Presentations.Open(str(pptx_path.resolve()), WithWindow=False)
        presentation.Export(str(output_dir), "PNG")
    finally:
        if presentation is not None:
            presentation.Close()
        if powerpoint is not None:
            powerpoint.Quit()

    images = _collect_slide_images(output_dir)
    if images:
        return images
    raise RuntimeError("No slide images were produced")


def _render_with_libreoffice(pptx_path: Path, output_dir: Path) -> list[Path]:
    libreoffice_bin = os.getenv("LIBREOFFICE_BIN", "soffice").strip() or "soffice"

    try:
        import pypdfium2 as pdfium  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"pypdfium2 import failed: {exc}") from exc

    with tempfile.TemporaryDirectory(prefix="slidepilot_lo_") as temp_dir:
        temp_path = Path(temp_dir)
        profile_dir = temp_path / "profile"
        out_dir = temp_path / "out"
        profile_dir.mkdir(parents=True, exist_ok=True)
        out_dir.mkdir(parents=True, exist_ok=True)

        # Isolated LO profile avoids lock/contention issues in server environments.
        cmd = [
            libreoffice_bin,
            f"-env:UserInstallation=file:///{profile_dir.as_posix()}",
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--convert-to",
            "pdf",
            "--outdir",
            str(out_dir),
            str(pptx_path.resolve()),
        ]
        try:
            subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
                timeout=int(os.getenv("SLIDE_RENDER_TIMEOUT", "180")),
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"LibreOffice binary '{libreoffice_bin}' not found. "
                "Install LibreOffice or set LIBREOFFICE_BIN."
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("LibreOffice conversion timed out") from exc
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").strip()
            stdout = (exc.stdout or "").strip()
            msg = stderr or stdout or "unknown conversion error"
            raise RuntimeError(f"LibreOffice conversion failed: {msg}") from exc

        pdf_path = out_dir / f"{pptx_path.stem}.pdf"
        if not pdf_path.exists():
            raise RuntimeError("LibreOffice did not produce a PDF output")

        pdf = pdfium.PdfDocument(str(pdf_path))
        try:
            for idx in range(len(pdf)):
                page = pdf[idx]
                bitmap = page.render(scale=2)
                image = bitmap.to_pil()
                image.save(output_dir / f"Slide{idx + 1}.png")
        finally:
            pdf.close()

    images = _collect_slide_images(output_dir)
    if images:
        return images
    raise RuntimeError("No slide images were produced from LibreOffice output")


def render_pptx_to_images(pptx_path: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    _clear_old_images(output_dir)

    renderers: list[tuple[str, Callable[[Path, Path], list[Path]]]]
    if os.name == "nt":
        renderers = [
            ("comtypes", _render_with_comtypes),
            ("win32com", _render_with_win32com),
            ("libreoffice", _render_with_libreoffice),
        ]
    else:
        renderers = [("libreoffice", _render_with_libreoffice)]

    errors: list[str] = []
    for name, renderer in renderers:
        try:
            return renderer(pptx_path, output_dir)
        except Exception as exc:
            errors.append(f"{name} attempt: {exc}")

    details = "; ".join(errors) if errors else "No renderer attempts were made."
    raise RuntimeError(f"Slide export failed. {details}")
