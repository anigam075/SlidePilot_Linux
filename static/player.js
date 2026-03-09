const deckPanel = document.getElementById("deckPanel");
const slideTitle = document.getElementById("slideTitle");
const slideCounter = document.getElementById("slideCounter");
const slideImage = document.getElementById("slideImage");
const slideImageHint = document.getElementById("slideImageHint");
const scriptBox = document.getElementById("scriptBox");
const chatFeed = document.getElementById("chatFeed");
const qnaWidget = document.getElementById("qnaWidget");
const qnaToggleBtn = document.getElementById("qnaToggleBtn");
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
const prevSlideBtn = document.getElementById("prevSlideBtn");
const nextSlideBtn = document.getElementById("nextSlideBtn");
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
let playbackToken = 0;
let qnaAvailable = false;

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.style.color = isError ? "#b00020" : "#2f5976";
}

function appendChatMessage(text, role) {
  if (!chatFeed || !text) return;
  const bubble = document.createElement("div");
  bubble.className = `chat-msg ${role === "user" ? "user" : "assistant"}`;
  bubble.textContent = text;
  chatFeed.appendChild(bubble);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function clearChat() {
  if (!chatFeed) return;
  chatFeed.innerHTML = "";
}

function setQnAAvailability(enabled) {
  qnaAvailable = enabled;
  qnaWidget.classList.toggle("hidden", !enabled);
  if (!enabled) {
    qnaSection.classList.add("hidden");
    qnaToggleBtn.textContent = "Chat";
  }
}

function toggleQnA(open) {
  if (!qnaAvailable) return;
  const shouldOpen = typeof open === "boolean" ? open : qnaSection.classList.contains("hidden");
  qnaSection.classList.toggle("hidden", !shouldOpen);
  qnaToggleBtn.textContent = shouldOpen ? "Close" : "Chat";
}
function currentSlide() {
  return deck?.slides?.[currentSlideIndex] || null;
}

function setNavState() {
  const hasDeck = Boolean(deck && deck.total_slides);
  prevSlideBtn.disabled = !hasDeck || currentSlideIndex <= 0;
  nextSlideBtn.disabled = !hasDeck || currentSlideIndex >= deck.total_slides - 1;
}

function interruptCurrentPlayback() {
  playbackToken += 1;
  audioPlayer.pause();
}

async function playCurrentSlideAudioManual() {
  const slide = currentSlide();
  if (!slide?.audio_url) {
    setStatus("Narration for this slide is not ready yet.", true);
    return;
  }
  audioPlayer.src = slide.audio_url;
  try {
    await audioPlayer.play();
    setStatus(`Playing slide ${slide.slide_number} narration...`);
  } catch {
    setStatus("Unable to play this slide audio.", true);
  }
}

async function navigateSlide(direction) {
  if (!deck) return;

  const targetIndex = Math.max(0, Math.min(deck.total_slides - 1, currentSlideIndex + direction));
  if (targetIndex === currentSlideIndex) return;

  const wasAutoRunning = autoPresentationRunning;
  const shouldKeepNarration = !audioPlayer.paused;

  interruptCurrentPlayback();
  currentSlideIndex = targetIndex;
  renderSlide();

  // If autoplay is active, the autoplay loop will resume from this slide.
  if (wasAutoRunning) {
    isPaused = false;
    narrateBtn.textContent = "Pause";
    return;
  }

  if (shouldKeepNarration) {
    await playCurrentSlideAudioManual();
  }
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
  questionInput.value = "";
  audioPlayer.src = slide.audio_url || "";
  setNavState();
}

function setPresentationButtonIdle() {
  autoPresentationRunning = false;
  isPaused = false;
  narrateBtn.disabled = !deck;
  narrateBtn.textContent = hasCompletedPresentation
    ? "Replay Presentation"
    : "Start Presentation";
  setNavState();
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
  if (command.includes("open chat") || command.includes("open qna") || command.includes("open q and a")) {
    if (!qnaAvailable) {
      setStatus("QnA opens after presentation finishes.", true);
      return;
    }
    toggleQnA(true);
    setStatus("Chat opened.");
    return;
  }
  if (command.includes("close chat") || command.includes("hide chat") || command.includes("close qna")) {
    if (!qnaAvailable) {
      setStatus("QnA opens after presentation finishes.", true);
      return;
    }
    toggleQnA(false);
    setStatus("Chat closed.");
    return;
  }
  if (command.includes("go to previous slide and play") || command.includes("previous slide and play")) {
    if (currentSlideIndex <= 0) {
      setStatus("Already at the first slide.", true);
      return;
    }
    await navigateSlide(-1);
    await playCurrentSlideAudioManual();
    return;
  }
  if (command === "next slide" || command.includes("go to next slide")) {
    await navigateSlide(1);
    return;
  }
  if (command === "previous slide" || command.includes("move to previous slide")) {
    await navigateSlide(-1);
    return;
  }
  if (command.includes("replay slide")) {
    if (autoPresentationRunning) {
      isPaused = false;
      narrateBtn.textContent = "Pause";
      setStatus("Replaying current slide...");
      interruptCurrentPlayback();
      return;
    }
    interruptCurrentPlayback();
    await playCurrentSlideAudioManual();
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
  if (!qnaAvailable) {
    setStatus("Voice question received. QnA opens after presentation finishes.", true);
    return;
  }
  if (qnaSection.classList.contains("hidden")) {
    toggleQnA(true);
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

function waitForAudioToEnd(startToken) {
  return new Promise((resolve, reject) => {
    const onEnded = () => {
      cleanup();
      resolve("ended");
    };
    const onError = () => {
      cleanup();
      reject(new Error("Audio playback failed."));
    };
    const interruptWatcher = setInterval(() => {
      if (startToken !== playbackToken) {
        cleanup();
        resolve("interrupted");
      }
    }, 80);
    const cleanup = () => {
      clearInterval(interruptWatcher);
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
  if (!deck || !slide) return "interrupted";
  if (!slide.audio_url) {
    throw new Error(`Missing narration audio for slide ${slide.slide_number}.`);
  }
  renderSlide();
  setStatus(`Playing slide ${slide.slide_number} narration...`);
  const startToken = playbackToken;
  await audioPlayer.play();
  return await waitForAudioToEnd(startToken);
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
    setQnAAvailability(false);
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
    setQnAAvailability(false);
    clearChat();
    await ensurePreparedDeck();

    autoPresentationRunning = true;
    hasCompletedPresentation = false;
    isPaused = false;
    narrateBtn.disabled = false;
    narrateBtn.textContent = "Pause";
    while (autoPresentationRunning && deck && currentSlideIndex < deck.total_slides) {
      const playbackState = await playCurrentSlideAudioAuto();
      if (!autoPresentationRunning) return;

      if (playbackState === "interrupted") {
        continue;
      }

      if (playbackState !== "ended") {
        return;
      }

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
      await waitForAudioToEnd(playbackToken);
    }
    setPresentationButtonIdle();
    setQnAAvailability(true);
    toggleQnA(false);
    setStatus("Narration complete. Use the Chat button for QnA.");
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
  interruptCurrentPlayback();
  window.location.href = "/";
});

prevSlideBtn.addEventListener("click", async () => {
  await navigateSlide(-1);
});

nextSlideBtn.addEventListener("click", async () => {
  await navigateSlide(1);
});

document.addEventListener("keydown", async (event) => {
  if (!deck) return;
  const targetTag = (event.target?.tagName || "").toLowerCase();
  if (targetTag === "input" || targetTag === "textarea") return;

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    await navigateSlide(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    await navigateSlide(1);
  }
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
  if (!qnaAvailable) {
    setStatus("QnA opens after presentation finishes.", true);
    return;
  }
  if (qnaSection.classList.contains("hidden")) {
    toggleQnA(true);
  }
  if (!question) {
    setStatus("Enter a question first.", true);
    return;
  }

  appendChatMessage(question, "user");
  questionInput.value = "";

  try {
    setStatus("Answering your presentation question...");
    askBtn.disabled = true;
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
    appendChatMessage(payload.answer || "I could not generate an answer.", "assistant");
    if (payload.audio_url) {
      audioPlayer.src = payload.audio_url;
      audioPlayer.play();
    }
    setStatus("Answer generated.");
  } catch (error) {
    setStatus(error.message || "QnA failed", true);
    appendChatMessage("I could not answer that right now. Please try again.", "assistant");
  } finally {
    askBtn.disabled = false;
  }
});

qnaToggleBtn.addEventListener("click", () => {
  toggleQnA();
});

updateFullscreenButton();
setVoiceButton();
setQnAAvailability(false);
loadDeck();
















