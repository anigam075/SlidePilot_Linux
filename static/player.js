const deckPanel = document.getElementById("deckPanel");
const slideTitle = document.getElementById("slideTitle");
const slideCounter = document.getElementById("slideCounter");
const slideImage = document.getElementById("slideImage");
const slideImageHint = document.getElementById("slideImageHint");
const scriptBox = document.getElementById("scriptBox");
const answerBox = document.getElementById("answerBox");
const qnaSection = document.getElementById("qnaSection");
const statusBox = document.getElementById("status");
const mediaPane = document.getElementById("mediaPane");
const voiceIndicator = document.getElementById("voiceIndicator");
const voiceIndicatorText = document.getElementById("voiceIndicatorText");

const narrateBtn = document.getElementById("narrateBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const homeBtn = document.getElementById("homeBtn");
const voiceBtn = document.getElementById("voiceBtn");
const askBtn = document.getElementById("askBtn");
const questionInput = document.getElementById("questionInput");
const audioPlayer = new Audio();

const deckId = document.body.dataset.deckId;

let deck = null;
let currentSlideIndex = 0;
let autoPresentationRunning = false;
let isPaused = false;
let hasCompletedPresentation = false;
let recognizer = null;
let voiceEnabled = false;
let wakeIndicatorTimeout = null;

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.style.color = isError ? "#b00020" : "#2f5976";
}

function currentSlide() {
  return deck?.slides?.[currentSlideIndex] || null;
}

function renderSlide() {
  const slide = currentSlide();
  if (!slide) return;
  slideTitle.textContent = `Slide ${slide.slide_number}`;
  slideCounter.textContent = `${slide.slide_number} / ${deck.total_slides}`;
  if (slide.image_url) {
    slideImage.src = slide.image_url;
    slideImage.classList.remove("hidden");
    slideImageHint.textContent = "";
  } else {
    slideImage.src = "";
    slideImage.classList.add("hidden");
    slideImageHint.textContent = "Slide preview image not available for this slide.";
  }
  scriptBox.textContent = slide.script || "";
  answerBox.textContent = "";
  questionInput.value = "";
  audioPlayer.src = slide.audio_url || "";
}

function setPresentationButtonIdle() {
  autoPresentationRunning = false;
  isPaused = false;
  narrateBtn.disabled = !deck;
  narrateBtn.textContent = hasCompletedPresentation
    ? "Replay Presentation"
    : "Start Presentation";
}

function updateFullscreenButton() {
  fullscreenBtn.textContent = document.fullscreenElement
    ? "Exit Fullscreen"
    : "Enter Fullscreen";
}

function setVoiceButton() {
  voiceBtn.textContent = voiceEnabled ? "Voice: On" : "Voice: Off";
  voiceIndicatorText.textContent = voiceEnabled ? "Listening for 'Slide pilot'" : "Wake word idle";
  voiceIndicator.classList.toggle("enabled", voiceEnabled);
}

async function fetchSpeechToken() {
  const response = await fetch("/api/speech/token");
  if (!response.ok) {
    throw new Error("Unable to fetch speech token.");
  }
  return response.json();
}

function normalizeVoiceText(text) {
  return text.toLowerCase().replace(/[.?!]/g, "").trim();
}

async function pushVoiceDebugToServer(text) {
  try {
    await fetch("/api/voice/debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Debug forwarding is best-effort only.
  }
}

async function handleVoiceCommand(rawText) {
  const normalized = normalizeVoiceText(rawText);
  const wakeMatch = normalized.match(/^slide[\s,.]*pilot[,\s:-]*(.*)$/);
  if (!wakeMatch) {
    return;
  }
  if (wakeIndicatorTimeout) {
    clearTimeout(wakeIndicatorTimeout);
  }
  voiceIndicator.classList.add("wake-hit");
  voiceIndicatorText.textContent = "Wake word detected";
  wakeIndicatorTimeout = setTimeout(() => {
    voiceIndicator.classList.remove("wake-hit");
    voiceIndicatorText.textContent = voiceEnabled ? "Listening for 'Slide pilot'" : "Wake word idle";
  }, 5000);

  const command = (wakeMatch[1] || "").trim();
  if (!command) return;

  if (command.includes("go to home") || command === "home") {
    homeBtn.click();
    return;
  }
  if (command.includes("start presentation")) {
    narrateBtn.click();
    return;
  }
  if (command.includes("replay presentation")) {
    hasCompletedPresentation = true;
    narrateBtn.click();
    return;
  }
  if (command.includes("enter fullscreen") || command.includes("enter full screen")) {
    if (!document.fullscreenElement) {
      fullscreenBtn.click();
    }
    return;
  }
  if (command.includes("exit fullscreen") || command.includes("exit full screen")) {
    if (document.fullscreenElement) {
      fullscreenBtn.click();
    }
    return;
  }
  if (command === "pause" || command.includes("pause")) {
    if (autoPresentationRunning && !isPaused) {
      narrateBtn.click();
    }
    return;
  }
  if (command === "resume" || command === "play" || command.includes("resume")) {
    if (autoPresentationRunning && isPaused) {
      narrateBtn.click();
    }
    return;
  }

  // Unmatched command after wake phrase is treated as a QnA question.
  if (qnaSection.classList.contains("hidden")) {
    setStatus("Voice question received. QnA opens after presentation finishes.", true);
    return;
  }
  questionInput.value = wakeMatch[1].trim();
  askBtn.click();
}

async function startVoiceRecognition() {
  const sdk = window.SpeechSDK;
  if (!sdk) {
    throw new Error("Azure Speech SDK not loaded in browser.");
  }
  const { token, region } = await fetchSpeechToken();
  const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
  speechConfig.speechRecognitionLanguage = "en-US";
  const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
  recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognized = async (_sender, event) => {
    if (event.result.reason !== sdk.ResultReason.RecognizedSpeech) return;
    const recognizedText = (event.result.text || "").trim();
    if (!recognizedText) return;
    await pushVoiceDebugToServer(recognizedText);
    await handleVoiceCommand(recognizedText);
  };
  recognizer.canceled = () => {
    setStatus("Voice recognition canceled.", true);
  };

  await new Promise((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(resolve, reject);
  });
  voiceEnabled = true;
  setVoiceButton();
  setStatus("Voice control is active. Start commands with 'Slide pilot ...'.");
}

async function stopVoiceRecognition() {
  if (!recognizer) return;
  await new Promise((resolve, reject) => {
    recognizer.stopContinuousRecognitionAsync(resolve, reject);
  });
  recognizer.close();
  recognizer = null;
  voiceEnabled = false;
  setVoiceButton();
  setStatus("Voice control stopped.");
}

function waitForAudioToEnd() {
  return new Promise((resolve, reject) => {
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Audio playback failed."));
    };
    const cleanup = () => {
      audioPlayer.removeEventListener("ended", onEnded);
      audioPlayer.removeEventListener("error", onError);
    };
    audioPlayer.addEventListener("ended", onEnded, { once: true });
    audioPlayer.addEventListener("error", onError, { once: true });
  });
}

async function ensurePreparedDeck() {
  const needsPrepare =
    !deck?.closing_audio_url ||
    deck.slides.some((slide) => !slide.script || !slide.audio_url);
  if (!needsPrepare) return;

  setStatus("Missing prepared narration. Generating now...");
  const response = await fetch(`/api/decks/${deck.deck_id}/prepare`, { method: "POST" });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "Preparation failed");
  }
  const prepared = await response.json();
  deck.slides = prepared.slides || deck.slides;
  deck.closing_statement = prepared.closing_statement;
  deck.closing_audio_url = prepared.closing_audio_url;
}

async function playCurrentSlideAudioAuto() {
  const slide = currentSlide();
  if (!deck || !slide) return;
  if (!slide.audio_url) {
    throw new Error(`Missing narration audio for slide ${slide.slide_number}.`);
  }
  renderSlide();
  setStatus(`Playing slide ${slide.slide_number} narration...`);
  await audioPlayer.play();
  await waitForAudioToEnd();
}

async function loadDeck() {
  if (!deckId) {
    setStatus("Deck id is missing.", true);
    return;
  }
  try {
    const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}`);
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Failed to load deck");
    }
    deck = await response.json();
    currentSlideIndex = 0;
    autoPresentationRunning = false;
    isPaused = false;
    hasCompletedPresentation = false;
    deckPanel.classList.remove("hidden");
    qnaSection.classList.add("hidden");
    setPresentationButtonIdle();
    renderSlide();
    if (deck.render_warning) {
      setStatus(`Loaded deck. Image rendering warning: ${deck.render_warning}`, true);
    } else {
      setStatus("Deck ready. Press Start Presentation.");
    }
  } catch (error) {
    setStatus(error.message || "Unable to load presentation", true);
  }
}

narrateBtn.addEventListener("click", async () => {
  if (!deck) return;
  if (autoPresentationRunning) {
    if (isPaused) {
      try {
        await audioPlayer.play();
        isPaused = false;
        narrateBtn.textContent = "Pause";
        setStatus("Presentation resumed.");
      } catch {
        setStatus("Unable to resume audio playback.", true);
      }
    } else {
      audioPlayer.pause();
      isPaused = true;
      narrateBtn.textContent = "Play";
      setStatus("Presentation paused.");
    }
    return;
  }

  try {
    if (hasCompletedPresentation) {
      currentSlideIndex = 0;
      renderSlide();
    }

    narrateBtn.disabled = true;
    qnaSection.classList.add("hidden");
    answerBox.textContent = "";
    await ensurePreparedDeck();

    autoPresentationRunning = true;
    hasCompletedPresentation = false;
    isPaused = false;
    narrateBtn.disabled = false;
    narrateBtn.textContent = "Pause";
    while (autoPresentationRunning && deck && currentSlideIndex < deck.total_slides) {
      await playCurrentSlideAudioAuto();
      if (!autoPresentationRunning) return;
      if (currentSlideIndex < deck.total_slides - 1) {
        currentSlideIndex += 1;
        renderSlide();
      } else {
        break;
      }
    }

    hasCompletedPresentation = true;
    const closingStatement =
      deck.closing_statement ||
      "If you have any question, feel free to drop your query in the QnA section. I will be happy to answer.";
    setStatus(closingStatement);
    if (deck.closing_audio_url) {
      audioPlayer.src = deck.closing_audio_url;
      await audioPlayer.play();
      await waitForAudioToEnd();
    }
    setPresentationButtonIdle();
    qnaSection.classList.remove("hidden");
    setStatus("Narration complete. Ask anything in the QnA zone.");
  } catch (error) {
    setPresentationButtonIdle();
    setStatus(error.message || "Presentation failed", true);
  }
});

fullscreenBtn.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (!slideImage.classList.contains("hidden")) {
      await mediaPane.requestFullscreen();
      return;
    }
    setStatus("Fullscreen is available only when a slide image is visible.", true);
  } catch {
    setStatus("Unable to toggle fullscreen mode.", true);
  }
});

document.addEventListener("fullscreenchange", updateFullscreenButton);

homeBtn.addEventListener("click", () => {
  audioPlayer.pause();
  window.location.href = "/";
});

voiceBtn.addEventListener("click", async () => {
  try {
    if (voiceEnabled) {
      await stopVoiceRecognition();
    } else {
      await startVoiceRecognition();
    }
  } catch (error) {
    voiceEnabled = false;
    setVoiceButton();
    setStatus(error.message || "Unable to toggle voice recognition.", true);
  }
});

askBtn.addEventListener("click", async () => {
  const question = questionInput.value.trim();
  if (!deck) return;
  if (qnaSection.classList.contains("hidden")) {
    setStatus("QnA opens after presentation finishes.", true);
    return;
  }
  if (!question) {
    setStatus("Enter a question first.", true);
    return;
  }

  try {
    setStatus("Answering your presentation question...");
    askBtn.disabled = true;
    answerBox.textContent = "";
    const response = await fetch(`/api/decks/${deck.deck_id}/qna`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "QnA failed");
    }
    const payload = await response.json();
    answerBox.textContent = payload.answer;
    if (payload.audio_url) {
      audioPlayer.src = payload.audio_url;
      audioPlayer.play();
    }
    setStatus("Answer generated.");
  } catch (error) {
    setStatus(error.message || "QnA failed", true);
  } finally {
    askBtn.disabled = false;
  }
});

updateFullscreenButton();
setVoiceButton();
loadDeck();
