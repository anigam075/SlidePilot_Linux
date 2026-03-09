from __future__ import annotations

from pathlib import Path


def render_pptx_to_images(pptx_path: Path, output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    for pattern in ("*.png", "*.PNG", "*.jpg", "*.JPG", "*.jpeg", "*.JPEG"):
        for existing in output_dir.glob(pattern):
            existing.unlink(missing_ok=True)

    # Preferred path: comtypes + SaveAs (ppSaveAsJPG=17), which is usually stable.
    try:
        import comtypes.client  # type: ignore

        powerpoint = None
        presentation = None
        try:
            powerpoint = comtypes.client.CreateObject("PowerPoint.Application")
            powerpoint.Visible = 1
            presentation = powerpoint.Presentations.Open(str(pptx_path.resolve()))
            presentation.SaveAs(str(output_dir.resolve()), 17)
        finally:
            if presentation is not None:
                presentation.Close()
            if powerpoint is not None:
                powerpoint.Quit()

        images = sorted(output_dir.glob("Slide*.*"))
        images = [p for p in images if p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
        if images:
            return images
    except Exception as comtypes_exc:
        comtypes_error = str(comtypes_exc)
    else:
        comtypes_error = "No slide images were produced"

    powerpoint = None
    presentation = None
    win32_error = None
    try:
        import win32com.client  # type: ignore

        powerpoint = win32com.client.Dispatch("PowerPoint.Application")
        powerpoint.Visible = 1
        presentation = powerpoint.Presentations.Open(str(pptx_path.resolve()), WithWindow=False)
        presentation.Export(str(output_dir), "PNG")
    except Exception as exc:
        win32_error = str(exc)
    finally:
        if presentation is not None:
            presentation.Close()
        if powerpoint is not None:
            powerpoint.Quit()

    images = sorted(output_dir.glob("Slide*.PNG"))
    if not images:
        images = sorted(output_dir.glob("Slide*.png"))
    if images:
        return images

    raise RuntimeError(
        "PowerPoint export failed. "
        f"comtypes attempt: {comtypes_error}. "
        f"win32com attempt: {win32_error or 'No slide images were produced'}."
    )
