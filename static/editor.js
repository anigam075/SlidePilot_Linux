const deckId = document.body.dataset.deckId;
const editorTitle = document.getElementById("editorTitle");
const editorStatus = document.getElementById("editorStatus");
const reviewMeta = document.getElementById("reviewMeta");
const slidesReview = document.getElementById("slidesReview");
const finalizeBtn = document.getElementById("finalizeBtn");
const editorHomeBtn = document.getElementById("editorHomeBtn");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const pageLabel = document.getElementById("pageLabel");

const PAGE_SIZE = 4;
let deck = null;
let currentPage = 1;
let totalPages = 1;
const dirtySlides = new Set();

function setStatus(message, isError = false) {
  editorStatus.textContent = message;
  editorStatus.style.color = isError ? "#b00020" : "#2f5976";
}

function currentSlideState(slideNumber) {
  return deck?.slides?.find((slide) => slide.slide_number === slideNumber) || null;
}

function setSlideDirty(slideNumber, dirty) {
  const selector = `.slide-review-card[data-slide-number="${slideNumber}"]`;
  const card = slidesReview.querySelector(selector);
  if (!card) return;
  card.classList.toggle("dirty", dirty);
  const saveBtn = card.querySelector("[data-action='save']");
  if (saveBtn) saveBtn.disabled = !dirty;
  const dirtyTag = card.querySelector("[data-role='dirty-tag']");
  if (dirtyTag) dirtyTag.classList.toggle("hidden", !dirty);
}

function updateMeta() {
  if (!deck) return;
  editorTitle.textContent = `${deck.filename} ? ${deck.total_slides} slides`;
  reviewMeta.classList.remove("hidden");
  reviewMeta.textContent = deck.finalized
    ? "Deck is finalized. Any edited or refreshed slide will require finalization again before playback."
    : "Draft narration is reviewed four slides at a time. Intro and conclusion are generated only when you finalize.";
}

function updatePagination() {
  pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}

function sourceLabel(slide) {
  if (slide.script_source === "custom") return "Custom";
  if (slide.script_source === "generated") return "AI Draft";
  return "Pending";
}

function createSlideCard(slide) {
  const isNarrationLoading = !slide.script;
  const card = document.createElement("article");
  card.className = "slide-review-card";
  card.dataset.slideNumber = String(slide.slide_number);
  card.classList.toggle("loading", isNarrationLoading);
  card.innerHTML = `
    <div class="slide-review-media">
      ${slide.image_url ? `<img src="${slide.image_url}" alt="Slide ${slide.slide_number} preview" class="slide-review-thumb" />` : `<div class="slide-review-thumb missing">Preview unavailable</div>`}
      <div class="slide-review-info">
        <div>
          <h3>Slide ${slide.slide_number}</h3>
        </div>
        <div class="slide-review-badges">
          <span class="review-badge">${sourceLabel(slide)}</span>
          <span class="review-badge warning hidden" data-role="dirty-tag">Unsaved</span>
        </div>
      </div>
    </div>
    <div class="slide-review-body">
      <div class="slide-script-shell ${isNarrationLoading ? "loading" : ""}">
        <textarea class="slide-script-editor" data-role="script-input" ${isNarrationLoading ? "disabled" : ""} placeholder="${isNarrationLoading ? "Generating narration for this slide..." : ""}">${slide.script || ""}</textarea>
        <div class="slide-script-loader ${isNarrationLoading ? "" : "hidden"}" data-role="script-loader">
          <span class="loader-dot"></span>
          <span>Generating narration...</span>
        </div>
      </div>
      <div class="slide-review-controls">
        <button type="button" data-action="refresh">Refresh</button>
        <button type="button" data-action="save" disabled>Save</button>
      </div>
    </div>
  `;

  const input = card.querySelector("[data-role='script-input']");
  input.addEventListener("input", () => {
    dirtySlides.add(slide.slide_number);
    setSlideDirty(slide.slide_number, true);
  });

  card.querySelector("[data-action='refresh']").addEventListener("click", async () => {
    if (dirtySlides.has(slide.slide_number)) {
      const shouldReplace = window.confirm("This slide has unsaved narration edits. Refreshing will replace them with a new AI draft. Continue?");
      if (!shouldReplace) return;
    }
    await refreshSlide(slide.slide_number);
  });

  card.querySelector("[data-action='save']").addEventListener("click", async () => {
    await saveSlide(slide.slide_number);
  });

  return card;
}

function getPageSlides(page) {
  if (!deck?.slides?.length) return [];
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, deck.total_slides);
  return deck.slides.slice(start, end);
}

function renderSlides(slides) {
  slidesReview.innerHTML = "";
  if (!slides?.length) {
    slidesReview.innerHTML = '<p class="muted">No slides available for review on this page.</p>';
    return;
  }
  for (const slide of slides) {
    slidesReview.appendChild(createSlideCard(slide));
    if (dirtySlides.has(slide.slide_number)) {
      setSlideDirty(slide.slide_number, true);
    }
  }
}

async function loadDeck() {
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}`);
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "Failed to load deck");
  }
  deck = await response.json();
  totalPages = Math.max(1, Math.ceil((deck.total_slides || 0) / PAGE_SIZE));
  updateMeta();
  updatePagination();
}

async function loadDraftPage(page, statusMessage = null) {
  if (statusMessage) {
    setStatus(statusMessage);
  }
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/draft?page=${page}&page_size=${PAGE_SIZE}`, {
    method: "POST",
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "Draft narration generation failed");
  }
  const payload = await response.json();
  currentPage = payload.current_page || page;
  totalPages = payload.total_pages || totalPages;
  if (!deck) {
    deck = payload;
  } else {
    deck.filename = payload.filename;
    deck.total_slides = payload.total_slides;
    deck.render_warning = payload.render_warning;
    deck.review_ready = payload.review_ready;
    deck.finalized = payload.finalized;
    deck.slides = deck.slides || [];
    for (const slide of payload.slides || []) {
      const index = deck.slides.findIndex((item) => item.slide_number === slide.slide_number);
      if (index >= 0) {
        deck.slides[index] = { ...deck.slides[index], ...slide };
      } else {
        deck.slides.push(slide);
      }
    }
  }
  updateMeta();
  updatePagination();
  renderSlides(payload.slides || []);
  return payload;
}

async function refreshSlide(slideNumber) {
  const selector = `.slide-review-card[data-slide-number="${slideNumber}"]`;
  const card = slidesReview.querySelector(selector);
  const refreshBtn = card?.querySelector("[data-action='refresh']");
  const saveBtn = card?.querySelector("[data-action='save']");
  if (refreshBtn) refreshBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  setStatus(`Generating a new draft for slide ${slideNumber}...`);
  try {
    const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/slides/${slideNumber}/refresh-script`, {
      method: "POST",
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || `Failed to refresh slide ${slideNumber}`);
    }
    const payload = await response.json();
    const slide = currentSlideState(slideNumber);
    if (slide) {
      slide.script = payload.script;
      slide.script_source = payload.script_source;
    }
    deck.finalized = false;
    dirtySlides.delete(slideNumber);
    await loadDraftPage(currentPage, `Slide ${slideNumber} draft refreshed.`);
  } catch (error) {
    setStatus(error.message || "Refresh failed", true);
    if (refreshBtn) refreshBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = !dirtySlides.has(slideNumber);
  }
}

async function saveSlide(slideNumber) {
  const selector = `.slide-review-card[data-slide-number="${slideNumber}"]`;
  const card = slidesReview.querySelector(selector);
  const input = card?.querySelector("[data-role='script-input']");
  if (!input) return;
  const script = input.value.trim();
  if (!script) {
    setStatus(`Slide ${slideNumber} narration cannot be empty.`, true);
    throw new Error("Narration cannot be empty");
  }
  const saveBtn = card.querySelector("[data-action='save']");
  const refreshBtn = card.querySelector("[data-action='refresh']");
  saveBtn.disabled = true;
  refreshBtn.disabled = true;
  setStatus(`Saving narration for slide ${slideNumber}...`);
  const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/slides/${slideNumber}/script`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script }),
  });
  if (!response.ok) {
    const err = await response.json();
    saveBtn.disabled = false;
    refreshBtn.disabled = false;
    throw new Error(err.detail || `Failed to save slide ${slideNumber}`);
  }
  const payload = await response.json();
  const slide = currentSlideState(slideNumber);
  if (slide) {
    slide.script = payload.script;
    slide.script_source = payload.script_source;
  }
  deck.finalized = false;
  dirtySlides.delete(slideNumber);
  await loadDraftPage(currentPage, `Slide ${slideNumber} narration saved.`);
}

async function saveAllDirtySlides() {
  const dirtyNumbers = Array.from(dirtySlides).sort((a, b) => a - b);
  for (const slideNumber of dirtyNumbers) {
    await saveSlide(slideNumber);
  }
}

async function changePage(nextPage) {
  if (nextPage === currentPage || nextPage < 1 || nextPage > totalPages) return;
  try {
    if (dirtySlides.size) {
      setStatus("Saving pending narration edits before changing page...");
      await saveAllDirtySlides();
    }
    currentPage = nextPage;
    updatePagination();
    renderSlides(getPageSlides(currentPage));
    await loadDraftPage(nextPage, `Loading slides ${((nextPage - 1) * PAGE_SIZE) + 1} to ${Math.min(nextPage * PAGE_SIZE, deck.total_slides)}...`);
    setStatus("Draft narration page loaded.");
  } catch (error) {
    setStatus(error.message || "Unable to change page", true);
  }
}

async function finalizeDeck() {
  if (!deck) return;
  finalizeBtn.disabled = true;
  prevPageBtn.disabled = true;
  nextPageBtn.disabled = true;
  try {
    await saveAllDirtySlides();
    setStatus("Finalizing presentation and generating intro, conclusion, and audio...");
    const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/finalize`, {
      method: "POST",
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Finalize failed");
    }
    deck = await response.json();
    setStatus("Presentation finalized. Opening player...");
    window.location.href = `/player/${encodeURIComponent(deckId)}`;
  } catch (error) {
    finalizeBtn.disabled = false;
    updatePagination();
    setStatus(error.message || "Finalize failed", true);
  }
}

finalizeBtn.addEventListener("click", finalizeDeck);
editorHomeBtn.addEventListener("click", () => {
  window.location.href = "/";
});
prevPageBtn.addEventListener("click", () => {
  changePage(currentPage - 1);
});
nextPageBtn.addEventListener("click", () => {
  changePage(currentPage + 1);
});

(async function init() {
  try {
    setStatus("Loading deck for narration review...");
    await loadDeck();
    renderSlides(getPageSlides(1));
    await loadDraftPage(1, "Generating draft narrations for slides 1 to 4...");
    if (deck.render_warning) {
      setStatus(`Draft narration ready. Slide image warning: ${deck.render_warning}`, true);
    } else {
      setStatus("Draft narration is ready. Review up to four slides and move page by page.");
    }
  } catch (error) {
    setStatus(error.message || "Unable to load review screen", true);
    finalizeBtn.disabled = true;
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
  }
})();
