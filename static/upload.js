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
    setStatus("Uploading deck and extracting slides...");
    const uploadResponse = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    if (!uploadResponse.ok) {
      const err = await uploadResponse.json();
      throw new Error(err.detail || "Upload failed");
    }
    const deck = await uploadResponse.json();

    setStatus("Upload complete. Opening narration review...");
    window.location.href = `/review/${encodeURIComponent(deck.deck_id)}`;
  } catch (error) {
    setStatus(error.message || "Processing failed", true);
  }
});
