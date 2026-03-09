const uploadForm = document.getElementById("uploadForm");
const pptFileInput = document.getElementById("pptFile");
const statusBox = document.getElementById("status");

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.style.color = isError ? "#b00020" : "#2f5976";
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pptFileInput.files.length) {
    setStatus("Choose a .pptx file first.", true);
    return;
  }

  const file = pptFileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  try {
    setStatus("Uploading and extracting slides...");
    const uploadResponse = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    if (!uploadResponse.ok) {
      const err = await uploadResponse.json();
      throw new Error(err.detail || "Upload failed");
    }
    const deck = await uploadResponse.json();

    setStatus("Engines on. Prepping all slide narrations for smooth playback...");
    const prepareResponse = await fetch(`/api/decks/${deck.deck_id}/prepare`, {
      method: "POST",
    });
    if (!prepareResponse.ok) {
      const err = await prepareResponse.json();
      throw new Error(err.detail || "Narration preparation failed");
    }

    window.location.href = `/player/${encodeURIComponent(deck.deck_id)}`;
  } catch (error) {
    setStatus(error.message || "Processing failed", true);
  }
});
