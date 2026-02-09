/* game.js (FULL)
/***********************
  Minyoung Maker (Stages 1–4)
  - 5 mini games: catch, pop, memory, react, dino
  - Mood system: neutral/happy/sad/angry
  - Random popup questions that affect mood (not obvious)
  - Shop hides affection effects + item effect popup
  - Any gift makes Minyoung happy sprite immediately
  - Stage evolves via TRIALS (pass/fail) instead of auto
  - Idle 30s without shopping or games => sad, 60s => angry
  - Dino Run upgrades: boing SFX, heart trail, stage-themed obstacles
  - NEW:
    - Trials have an entry "Are you ready?" popup (do not auto-start)
    - No restart button on fail (they can retry by accepting entry later)
    - Random popups NEVER fire during mini-games/trials/ending
    - Final ending triggers at affection >= 3000, also with entry popup
  - DEV CHEATS (NEW):
    - Press Ctrl+Shift+L anywhere (outside games) to open a cheat menu:
      • Unlimited Hearts
      • Unlimited Affection
      • Jump to a specific Stage Trial (2/3/4)
      • Quick affection set + pass/clear trials
************************/

const $ = (id) => document.getElementById(id);

const VIEWS = {
  home: $("view-home"),
  minigames: $("view-minigames"),
  shop: $("view-shop"),
  game: $("view-game")
};

const SAVE_KEY = "minyoungMakerSave_v3";

// ✅ cache buster so sprite updates aren’t stuck in browser cache
const SPRITE_VERSION = "v3.1";

const state = {
  hearts: 0,
  affection: 0,

  // IMPORTANT: "stage" is now the CURRENT unlocked stage,
  // gated by trials. Affection thresholds only set "desired stage".
  stage: 1, // 1..4 only

  mood: "neutral", // neutral | happy | sad | angry
  inventory: [],
  affectionMult: 1.0,
  flags: {},
  popupCooldown: 0,

  // timed buffs (counts down per popup roll)
  buffKoreanFeast: 0,
  buffTornadoFudge: 0,
  buffGoofyNate: 0,

  // NEW: stage trial gating + ending
  stageTrialPassed: { 2: false, 3: false, 4: false }, // stage 1 has no trial
  pendingStage: null, // next stage trial to attempt (2/3/4)
  trialCooldownUntil: 0, // avoid instant re-prompt loops
  endingSeen: false,

  // DEV CHEATS (persisted)
  cheats: {
    unlimitedHearts: false,
    unlimitedAffection: false
  },

  lastActionAt: Date.now()
};

// ✅ global locks
let isMiniGameRunning = false;
let isTrialRunning = false;
let isEndingRunning = false;

const STAGE_LABELS = {
  1: "Stage 1: Small Agi",
  2: "Stage 2: Medium Agi",
  3: "Stage 3: Big Agi",
  4: "Stage 4: Like Giant Agi"
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function clampStage(n) {
  return clamp(n, 1, 4);
}

function save() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}
function load() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    Object.assign(state, data);

    state.inventory ||= [];
    state.flags ||= {};
    state.affectionMult ||= 1.0;
    state.mood ||= "neutral";
    state.popupCooldown ||= 0;

    state.buffKoreanFeast ||= 0;
    state.buffTornadoFudge ||= 0;
    state.buffGoofyNate ||= 0;

    state.stageTrialPassed ||= { 2: false, 3: false, 4: false };
    state.pendingStage ||= null;
    state.trialCooldownUntil ||= 0;
    state.endingSeen ||= false;

    state.cheats ||= { unlimitedHearts: false, unlimitedAffection: false };

    state.lastActionAt ||= Date.now();
    state.stage = clampStage(state.stage || 1);
  } catch {}
}

function speak(msg) {
  $("dialogue").innerText = msg;
}

function showView(name) {
  Object.values(VIEWS).forEach((v) => v.classList.add("hidden"));
  VIEWS[name].classList.remove("hidden");
}

function touchAction() {
  state.lastActionAt = Date.now();
  // if she was angry from waiting, interacting calms her down
  if (state.mood === "angry") setMood("neutral", { persist: true });
  save();
}

function spritePathFor(stage, mood) {
  const s = clampStage(stage);
  const allowed = ["happy", "sad", "angry", "neutral"];
  const m = allowed.includes(mood) ? mood : "neutral";
  return `assets/characters/stage${s}-${m}.png?v=${SPRITE_VERSION}`;
}

function updateSprite() {
  const img = $("character");
  if (!img) return;

  const desired = spritePathFor(state.stage, state.mood);
  const neutral = spritePathFor(state.stage, "neutral");

  img.onload = null;
  img.onerror = null;

  img.onerror = () => {
    console.warn(
      `[Sprite missing] Tried: ${desired}\nFalling back to: ${neutral}\n` +
        `Check filename/path/case exactly matches stage${state.stage}-${state.mood}.png`
    );

    img.onerror = () => {
      console.error(
        `[Sprite missing] Even neutral sprite failed: ${neutral}\n` +
          `You need at least: assets/characters/stage${state.stage}-neutral.png`
      );
      img.removeAttribute("src");
      img.alt = `Missing sprite(s). Add stage${state.stage}-${state.mood}.png and stage${state.stage}-neutral.png`;
    };

    img.src = neutral;
  };

  img.src = desired;
}

function setMood(newMood, opts = { persist: true }) {
  const allowed = ["neutral", "happy", "sad", "angry"];
  state.mood = allowed.includes(newMood) ? newMood : "neutral";
  updateSprite();
  if (opts?.persist) save();
  renderHUD();
}

/***********************
  DEV CHEATS (helpers)
************************/
function enforceCheats() {
  // True infinite hearts
  if (state.cheats?.unlimitedHearts) {
    state.hearts = Infinity;
  }

  // True infinite affection
  if (state.cheats?.unlimitedAffection) {
    state.affection = Infinity;
  }

  save();
}
function openCheatMenu() {
  if (!canInterruptWithPopup()) return;

  const modal = $("modal");
  const actions = $("modalActions");
  actions.innerHTML = "";

  $("modalTitle").innerText = "🛠️ Dev Cheats";
  $("modalText").innerText =
    `Testing tools.\n\n` +
    `Unlimited Hearts: ${state.cheats?.unlimitedHearts ? "ON" : "OFF"}\n` +
    `Unlimited Affection: ${state.cheats?.unlimitedAffection ? "ON" : "OFF"}\n\n` +
    `Tip: You can also jump into any stage trial directly.`;

  function addBtn(label, onClick, ghost = false) {
    const b = document.createElement("button");
    b.className = ghost ? "btn ghost" : "btn";
    b.innerText = label;
    b.addEventListener("click", () => {
      touchAction();
      onClick?.();
    });
    actions.appendChild(b);
  }

  addBtn(
    `Toggle Unlimited Hearts (${state.cheats?.unlimitedHearts ? "ON" : "OFF"})`,
    () => {
      state.cheats.unlimitedHearts = !state.cheats.unlimitedHearts;
      enforceCheats();
      renderHUD();
      closePopup();
      speak(state.cheats.unlimitedHearts ? "Cheat: Unlimited hearts enabled." : "Cheat: Unlimited hearts disabled.");
    }
  );

  addBtn(
    `Toggle Unlimited Affection (${state.cheats?.unlimitedAffection ? "ON" : "OFF"})`,
    () => {
      state.cheats.unlimitedAffection = !state.cheats.unlimitedAffection;
      enforceCheats();
      recomputeStage();
      renderHUD();
      closePopup();
      speak(state.cheats.unlimitedAffection ? "Cheat: Unlimited affection enabled." : "Cheat: Unlimited affection disabled.");
    }
  );

  addBtn("Add +500 hearts", () => {
    state.hearts += 500;
    enforceCheats();
    renderHUD();
    closePopup();
    speak("Cheat: +500 hearts.");
  });

  addBtn("Add +500 affection", () => {
    state.affection += 500;
    enforceCheats();
    recomputeStage();
    closePopup();
    speak("Cheat: +500 affection.");
  });

  addBtn("Set affection to 150 (Stage 2 threshold)", () => {
    state.affection = 150;
    enforceCheats();
    recomputeStage();
    closePopup();
    speak("Cheat: affection set to 150.");
  });

  addBtn("Set affection to 500 (Stage 3 threshold)", () => {
    state.affection = 500;
    enforceCheats();
    recomputeStage();
    closePopup();
    speak("Cheat: affection set to 500.");
  });

  addBtn("Set affection to 1000 (Stage 4 threshold)", () => {
    state.affection = 1000;
    enforceCheats();
    recomputeStage();
    closePopup();
    speak("Cheat: affection set to 1000.");
  });

  addBtn("Set affection to 3000 (Ending threshold)", () => {
    state.affection = 3000;
    enforceCheats();
    recomputeStage();
    closePopup();
    speak("Cheat: affection set to 3000.");
  });

  addBtn("Start Stage 2 Trial now", () => {
    state.trialCooldownUntil = 0;
    closePopup();
    promptTrialEntry(2);
  });

  addBtn("Start Stage 3 Trial now", () => {
    state.trialCooldownUntil = 0;
    closePopup();
    promptTrialEntry(3);
  });

  addBtn("Start Stage 4 Trial now", () => {
    state.trialCooldownUntil = 0;
    closePopup();
    promptTrialEntry(4);
  });

  addBtn("Mark ALL trials passed", () => {
    state.stageTrialPassed[2] = true;
    state.stageTrialPassed[3] = true;
    state.stageTrialPassed[4] = true;
    save();
    recomputeStage();
    closePopup();
    speak("Cheat: all trials marked as passed.");
  });

  addBtn("Clear trial passes", () => {
    state.stageTrialPassed[2] = false;
    state.stageTrialPassed[3] = false;
    state.stageTrialPassed[4] = false;
    save();
    recomputeStage();
    closePopup();
    speak("Cheat: trial passes cleared.");
  });

  addBtn("Close", () => {
    closePopup();
    speak("Minyoung is watching you debug… 😑");
  }, true);

  modal.classList.remove("hidden");
}

/***********************
  Stage gating + trials + ending
************************/
function desiredStageFromAffection(a) {
  let s = 1;
  if (a >= 500) s = 2;
  if (a >= 1000) s = 3;
  if (a >= 2000) s = 4;
  return clampStage(s);
}

function recomputeStage() {
  enforceCheats();

  const a = state.affection || 0;
  const desired = desiredStageFromAffection(a);

  // Gate progression: must pass each stage trial to unlock that stage.
  let unlocked = 1;

  if (desired >= 2 && state.stageTrialPassed?.[2]) unlocked = 2;
  if (desired >= 3 && state.stageTrialPassed?.[2] && state.stageTrialPassed?.[3]) unlocked = 3;
  if (desired >= 4 && state.stageTrialPassed?.[2] && state.stageTrialPassed?.[3] && state.stageTrialPassed?.[4]) unlocked = 4;
  if (!Number.isFinite(a)) return 4;

  unlocked = clampStage(unlocked);

  if (unlocked !== state.stage) {
    state.stage = unlocked;
    state.mood = "neutral";
  }

  updateSprite();
  save();
  renderHUD();

  // If desired is ahead of unlocked, we should offer the next trial entry popup
  maybeStartTrialForStage(desired);

  // Ending trigger at 3000 affection
  maybeStartEnding();
}

function addRewards(heartsEarned, affectionEarned) {
  state.hearts += heartsEarned;
  const boosted = Math.round(affectionEarned * (state.affectionMult || 1));
  state.affection += boosted;

  enforceCheats();
  save();
  recomputeStage();
  renderHUD();
}

function canInterruptWithPopup() {
  if (isMiniGameRunning) return false;
  if (isTrialRunning) return false;
  if (isEndingRunning) return false;
  return true;
}

/***********************
  Entry prompt for trials + ending
************************/
function promptTrialEntry(stageNum) {
  if (!canInterruptWithPopup()) return false;

  const now = Date.now();
  if ((state.trialCooldownUntil || 0) > now) return false;

  const modal = $("modal");
  const titleMap = {
    2: "🍲 Stage 2 Trial: Make Perfect Dakgalbi",
    3: "🛸 Stage 3 Trial: Pixel Space Pinball",
    4: "🎉 Stage 4 Trial: Minyoung Party"
  };

  const descMap = {
    2: "Time the heat perfectly. Pass to unlock Stage 2 evolution.",
    3: "Score points in pixel pinball. Pass to unlock Stage 3 evolution.",
    4: "Survive the party. Pass to unlock Stage 4 evolution."
  };

  $("modalTitle").innerText = "⚠️ Evolution Trial";
  $("modalText").innerText =
    `${titleMap[stageNum] || `Stage ${stageNum} Trial`}\n\n` +
    `${descMap[stageNum] || "A trial awaits."}\n\n` +
    `Are you ready to enter?`;

  const actions = $("modalActions");
  actions.innerHTML = "";

  const go = document.createElement("button");
  go.className = "btn";
  go.innerText = "Yes, enter";
  go.addEventListener("click", () => {
    closePopup();
    touchAction();
    startStageTrial(stageNum);
  });

  const later = document.createElement("button");
  later.className = "btn ghost";
  later.innerText = "Not yet";
  later.addEventListener("click", () => {
    closePopup();
    touchAction();
    state.trialCooldownUntil = Date.now() + 10000; // 10s
    save();
    speak("Minyoung: “Okay. Tell me when you’re ready.”");
  });

  actions.appendChild(go);
  actions.appendChild(later);

  modal.classList.remove("hidden");
  return true;
}

function promptEndingEntry() {
  if (!canInterruptWithPopup()) return false;

  const now = Date.now();
  if ((state.trialCooldownUntil || 0) > now) return false; // reuse cooldown

  const modal = $("modal");

  $("modalTitle").innerText = "💫 Final Trial";
  $("modalText").innerText =
    `Affection reached 3000.\n\n` +
    `This is the ending.\n` +
    `Choices matter.\n\n` +
    `Are you ready?`;

  const actions = $("modalActions");
  actions.innerHTML = "";

  const go = document.createElement("button");
  go.className = "btn";
  go.innerText = "Yes, begin";
  go.addEventListener("click", () => {
    closePopup();
    touchAction();
    startFinalEnding();
  });

  const later = document.createElement("button");
  later.className = "btn ghost";
  later.innerText = "Not yet";
  later.addEventListener("click", () => {
    closePopup();
    touchAction();
    state.trialCooldownUntil = Date.now() + 12000;
    save();
    speak("Minyoung: “Okay. I’ll wait. 🥺”");
  });

  actions.appendChild(go);
  actions.appendChild(later);

  modal.classList.remove("hidden");
  return true;
}

function maybeStartTrialForStage(desiredStage) {
  if (!canInterruptWithPopup()) return false;

  const now = Date.now();
  if ((state.trialCooldownUntil || 0) > now) return false;

  // Find next required stage trial in order
  for (const s of [2, 3, 4]) {
    if (desiredStage >= s && !state.stageTrialPassed?.[s]) {
      state.pendingStage = s;
      save();
      // DO NOT auto-start; ask first
      return promptTrialEntry(s);
    }
  }
  return false;
}

function maybeStartEnding() {
  if (!canInterruptWithPopup()) return false;

  if (state.endingSeen) return false;
  if ((state.affection || 0) < 3000) return false;

  // Only after stage 4 trial is passed (optional but feels right)
  if (!state.stageTrialPassed?.[4]) return false;

  return promptEndingEntry();
}

/***********************
  Trial helpers
************************/
function startStageTrial(stageNum) {
  touchAction();

  isTrialRunning = true;
  isMiniGameRunning = true; // treat like a game so random popups never fire

  showView("game");
  const area = $("gameArea");
  area.innerHTML = "";
  stopCurrentGame = null;

  if (stageNum === 2) return trialDakgalbi(area);
  if (stageNum === 3) return trialPinball(area);
  if (stageNum === 4) return trialMinyoungParty(area);

  // fallback
  isTrialRunning = false;
  isMiniGameRunning = false;
  showView("home");
}

function finishStageTrial(stageNum, passed) {
  isTrialRunning = false;
  isMiniGameRunning = false;

  if (passed) {
    state.stageTrialPassed[stageNum] = true;
    state.pendingStage = null;
    setMood("happy", { persist: true });
    speak("Minyoung: “Okay… you did it. 😳💗”");
  } else {
    // No restart button; cooldown so it won't instantly re-trigger
    state.trialCooldownUntil = Date.now() + 6000;
    speak("Minyoung: “Try again later… when you’re ready.” 🥺");
  }

  save();
  recomputeStage();
  renderHUD();
}

/***********************
  FINAL ENDING (Dating game)
************************/
function startFinalEnding() {
  touchAction();

  isEndingRunning = true;
  isMiniGameRunning = true; // block random popups

  showView("game");
  const root = $("gameArea");
  root.innerHTML = "";
  stopCurrentGame = null;

  $("gameTitle").innerText = "💫 The Ending: Minyoung Maker";

  // Simple branching dating scene, with cute “all assets” montage panel
  const container = document.createElement("div");
  container.className = "game-frame";
  container.innerHTML = `
    <div class="row">
      <div>Choices matter • no takebacks</div>
      <div><strong id="endPath">…</strong></div>
    </div>

    <div style="display:flex; gap:12px; margin-top:12px; align-items:flex-start; flex-wrap:wrap;">
      <div style="flex:1; min-width:320px;">
        <div id="endText" style="white-space:pre-line; padding:12px; border-radius:14px; border:1px dashed rgba(255,77,136,.35); background:rgba(255,255,255,.7);"></div>
        <div id="endChoices" style="display:flex; flex-direction:column; gap:10px; margin-top:12px;"></div>
      </div>

<div style="width:320px; border-radius:14px; border:1px dashed rgba(255,77,136,.35); background:rgba(255,255,255,.65); padding:10px;">
  <div class="small" style="margin-bottom:8px;"><strong>Memory Wall</strong></div>

  <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px;">
    <img style="width:100%; border-radius:12px;" src="assets/characters/memory1.jpg" alt="memory1">
    <img style="width:100%; border-radius:12px;" src="assets/characters/memory2.jpg" alt="memory2">
    <img style="width:100%; border-radius:12px;" src="assets/characters/memory3.jpg" alt="memory3">
  </div>

  <div class="small" style="margin-top:10px; white-space:pre-line;" id="endNote"></div>
</div>

    </div>

    <div class="center small" style="margin-top:10px;" id="endMsg"></div>
  `;
  root.appendChild(container);

  const endText = $("endText");
  const endChoices = $("endChoices");
  const endPath = $("endPath");
  const endNote = $("endNote");

  let scoreSoft = 0;   // cozy + presence
  let scoreChaos = 0;  // silly + playful
  let scoreDevotion = 0; // thoughtful + romantic

  function setScene(text, choices) {
    endText.innerText = text;
    endChoices.innerHTML = "";
    choices.forEach((c) => {
      const b = document.createElement("button");
      b.className = "btn";
      b.innerText = c.label;
      b.addEventListener("click", () => {
        touchAction();
        if (c.soft) scoreSoft += c.soft;
        if (c.chaos) scoreChaos += c.chaos;
        if (c.devotion) scoreDevotion += c.devotion;
        updatePathLabel();
        c.onPick?.();
      });
      endChoices.appendChild(b);
    });
  }

  function updatePathLabel() {
    const top = Math.max(scoreSoft, scoreChaos, scoreDevotion);
    let name = "…";
    if (top === 0) name = "…";
    else if (top === scoreDevotion) name = "Path: Soul Card";
    else if (top === scoreSoft) name = "Path: Quiet Cozy";
    else name = "Path: Chaos Cute";
    endPath.innerText = name;

    endNote.innerText =
      `Cozy: ${scoreSoft}\n` +
      `Chaos: ${scoreChaos}\n` +
      `Devotion: ${scoreDevotion}`;
  }

  function finishEnding() {
    // Determine ending
    let endingKey = "cozy";
    const top = Math.max(scoreSoft, scoreChaos, scoreDevotion);
    if (top === scoreDevotion) endingKey = "soul";
    else if (top === scoreChaos) endingKey = "chaos";
    else endingKey = "cozy";

    let endingText = "";
    let mood = "happy";

    if (endingKey === "soul") {
      endingText =
        "ENDING: Soulmates\n\n" +
        "You didn’t just love her loudly.\n" +
        "You loved her right.\n\n" +
        "Minyoung: “Okay… stop. I’m gonna cry.” 💗";
      mood = "happy";
    } else if (endingKey === "chaos") {
      endingText =
        "ENDING: Chaos Cute\n\n" +
        "You made love feel light.\n" +
        "Not shallow. Just… breathable.\n\n" +
        "Minyoung: “Why are you like that… I’m addicted.” 💘";
      mood = "happy";
    } else {
      endingText =
        "ENDING: Quiet Cozy\n\n" +
        "No fireworks needed.\n" +
        "Just presence.\n\n" +
        "Minyoung: “This is my favorite version of life.” 🌙";
      mood = "happy";
    }

    setMood(mood, { persist: true });
    speak("Minyoung: “That’s it… that’s the ending.” 💫");

    $("endMsg").innerText = "The story is complete 💗";

    // Lock ending
    state.endingSeen = true;
    state.flags.endingKey = endingKey;
    save();

    endChoices.innerHTML = "";
    const back = document.createElement("button");
    back.className = "btn";
    back.innerText = "Return Home";
    back.addEventListener("click", () => {
      touchAction();
      isEndingRunning = false;
      isMiniGameRunning = false;
      showView("home");
      renderHUD();
      speak(endingText);
    });
    endChoices.appendChild(back);
  }

  // Scenes
  updatePathLabel();

  setScene(
    "The night looks like pixel starlight.\nMinyoung turns to you.\n\nMinyoung: “So… what are we doing, exactly?”",
    [
      {
        label: "“I'm showing you what you mean to me.”",
        soft: 2,
        devotion: 1,
        onPick: () => {
          setScene(
            "She nods slowly.\n\nMinyoung: “Okay. Then show me.”",
            [
              {
                label: "Cook her something warm, no questions asked.",
                soft: 2,
                devotion: 1,
                onPick: () => {
                  setScene(
                    "You already know what she needs.\nShe watches you like she’s memorizing your hands.\n\nMinyoung: “That’s… so sweet of you.”",
                    [
                      {
                        label: "Make a silly joke to cut the tension.",
                        chaos: 2,
                        onPick: () => {
                          setScene(
                            "She laughs. \n\nMinyoung: “Afi! I am not food, hahaha!”",
                            [
                              { label: "Hold her hand.", soft: 1, devotion: 2, onPick: finishEnding },
                              { label: "Say “I love you so much.” very plainly.", devotion: 3, onPick: finishEnding }
                            ]
                          );
                        }
                      },
                      {
                        label: "Write a short, honest card.",
                        devotion: 3,
                        onPick: () => {
                          setScene(
                            "She reads it twice.\nOnce with her eyes.\nOnce with her whole heart.\n\nMinyoung: “Stop…”",
                            [
                              { label: "Kiss her forehead.", soft: 2, devotion: 1, onPick: finishEnding },
                              { label: "Hug her tight, until you feel each other's heartbeats.", chaos: 1, soft: 1, onPick: finishEnding }
                            ]
                          );
                        }
                      }
                    ]
                  );
                }
              },
              {
                label: "Sit next to her and match her silence.",
                soft: 3,
                onPick: () => {
                  setScene(
                    "Time slows.\nShe leans into you like it’s the most comfortable place to be.\n\nMinyoung: “You make me feel so cozy.”",
                    [
                      { label: "Don't go. I don't want you to go.", soft: 3, onPick: finishEnding },
                      { label: "Whisper something sweet.", devotion: 2, soft: 1, onPick: finishEnding }
                    ]
                  );
                }
              }
            ]
          );
        }
      },
      {
        label: "“We’re doing something dumb and romantic.”",
        chaos: 2,
        devotion: 1,
        onPick: () => {
          setScene(
            "Minyoung: “Explain dumb.”\n\nThe stars blink like they’re listening.",
            [
              {
                label: "Herbal butthole show.",
                chaos: 3,
                onPick: () => {
                  setScene(
                    "She tries to stay serious.\nShe fails.\n\nMinyoung: “I hate you.” (affectionate)",
                    [
                      { label: "Bring out the snack tray you prepared.", chaos: 1, soft: 2, onPick: finishEnding },
                      { label: "You go serious and say: “But, whose butthole will be on the show?”", chaos: 3, onPick: finishEnding }
                    ]
                  );
                }
              },
              {
                label: "Tell her one specific thing you love about her.",
                devotion: 3,
                onPick: () => {
                  setScene(
                    "Her black black eyes go soft.\n\nMinyoung: “Noooo lies lies lies!”",
                    [
                      { label: "Say it again, slower.", devotion: 3, onPick: finishEnding },
                      { label: "Switch to teasing to save her blush.", chaos: 2, onPick: finishEnding }
                    ]
                  );
                }
              }
            ]
          );
        }
      }
    ]
  );

  stopCurrentGame = () => {
    isEndingRunning = false;
    isMiniGameRunning = false;
  };
}

/***********************
  Idle anger/sadness watcher
************************/
function startIdleWatcher() {
  setInterval(() => {
    const now = Date.now();
    const idleMs = now - (state.lastActionAt || now);

    // 60 seconds → Angry
    if (idleMs >= 60000) {
      if (state.mood !== "angry") {
        setMood("angry", { persist: true });
        speak("Minyoung has been waiting forever!! 😤");
      }
    }

    // 30 seconds → Sad (only if not already angry)
    else if (idleMs >= 30000) {
      if (state.mood !== "sad") {
        setMood("sad", { persist: true });
        speak("Stella looks a little lonely… 🥺");
      }
    }
  }, 500);
}

/***********************
  Popup Questions (not obvious)
************************/
const POPUPS = [
  {
    title: "A tiny decision appears…",
    text: "Minyoung is staring at the fridge for about 10 seconds now, without saying anything.\nWhat do you do?",
    options: [
      { label: "Quietly rearrange it, she'll get upset in 2 seconds.", mood: "happy", hearts: +2, affection: +3 },
      { label: "Ask her what she is doing and tell her we should watch something fun.", mood: "angry", hearts: +1, affection: -2 }
    ]
  },
  {
    title: "Choose wisely!",
    text: "Minyoung sends a single message:\n“🙂”\nWhat is your response?",
    options: [
      { label: "Reply with a picture of something that reminds you of her.", mood: "happy", hearts: +1, affection: +4 },
      { label: "Reply: “Mmm look at those googly eyes, tasty tasty” like a creepy pervert.", mood: "happy", hearts: +2, affection: -1 }
    ]
  },
  {
    title: "Unexpected test",
    text: "Minyoung is quiet on the couch. She looks fine but… suspiciously fine.\nWhat do you do?",
    options: [
      { label: "Sit next to her and match her silence. Just presence.", mood: "happy", hearts: 0, affection: +5 },
      { label: "Talk shit about something she dislikes to distract her.", mood: "angry", hearts: +2, affection: -2 },
      { label: "Bring her all the snack options", mood: "happy", hearts: +10, affection: +10 }
    ]
  },
  {
    title: "A micro-drama",
    text: "Minyoung says: “I had a long day.”\nPick the move.",
    options: [
      { label: "Ask one gentle question and then offer food.", mood: "happy", hearts: +1, affection: +4 },
      { label: "Immediately suggest a productivity system.", mood: "sad", hearts: +2, affection: -1 }
    ]
  },
  {
    title: "Confusing but important",
    text: "Minyoung points at a random object and goes:\n“This has my vibe.”\nYou…",
    options: [
      { label: "Agree instantly and treat it like sacred lore.", mood: "happy", hearts: +2, affection: +3 },
      { label: "Ask for a rubric so you can understand vibe categories.", mood: "angry", hearts: +1, affection: -2 }
    ]
  },
  {
    title: "What do you fucking want?",
    text: "It's her birthday! She says:\n“Nate, you totally don't have to get me anything...”\nYou…",
    options: [
      { label: "take her words literally and don't get her anything.", mood: "sad", hearts: -20, affection: -20 },
      { label: "Get her a dozen of Krispy Kreme donuts with cute candles", mood: "happy", hearts: +2, affection: +5 },
      { label: "Write her a beautiful, heartfelt card.", mood: "happy", hearts: +2, affection: -2 },
      { label: "Get her the item she mentioned she liked before.", mood: "happy", hearts: +20, affection: +20 },
      { label: "Go on a trip to Cancun by yourself to avoid all this.", mood: "angry", hearts: -100, affection: -100 }
    ]
  }
];

function maybePopup(context = "any") {
  // ✅ never during mini-games, trials, or ending
  if (!canInterruptWithPopup()) return;

  if (state.popupCooldown > 0) {
    state.popupCooldown -= 1;
    save();
    return;
  }

  let chance = context === "afterGame" ? 0.55 : context === "afterGift" ? 0.35 : 0.25;
  if (state.buffTornadoFudge > 0 && Math.random() < 0.25) chance += 0.12;
  if (Math.random() > chance) return;

  const pick = POPUPS[Math.floor(Math.random() * POPUPS.length)];
  openPopup(pick);

  state.popupCooldown = 2;

  if (state.buffKoreanFeast > 0) state.buffKoreanFeast -= 1;
  if (state.buffTornadoFudge > 0) state.buffTornadoFudge -= 1;
  if (state.buffGoofyNate > 0) state.buffGoofyNate -= 1;

  save();
}

function openPopup(popup) {
  const modal = $("modal");
  $("modalTitle").innerText = popup.title;
  $("modalText").innerText = popup.text;

  const actions = $("modalActions");
  actions.innerHTML = "";

  popup.options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.innerText = opt.label;

    btn.addEventListener("click", () => {
      closePopup();
      touchAction();

      if (typeof opt.hearts === "number") state.hearts += opt.hearts;

      if (typeof opt.affection === "number") {
        const boosted = Math.round(opt.affection * (state.affectionMult || 1));
        state.affection += boosted;
      }

      let finalMood = opt.mood;

      if (state.buffKoreanFeast > 0 && (finalMood === "sad" || finalMood === "angry")) {
        if (Math.random() < 0.55) finalMood = "neutral";
        if (Math.random() < 0.35) finalMood = "happy";
      }

      if (state.buffGoofyNate > 0 && finalMood !== "happy") {
        if (Math.random() < 0.3) finalMood = "happy";
      }

      if (state.buffTornadoFudge > 0 && (finalMood === "sad" || finalMood === "angry")) {
        if (Math.random() < 0.4) finalMood = "neutral";
        if (Math.random() < 0.2) finalMood = "happy";
      }

      setMood(finalMood, { persist: true });

      enforceCheats();
      save();
      recomputeStage();
      renderHUD();

      const reaction = {
        happy: "Minyoung looks pleased. Her black black eyes are filled with joy 💗",
        sad: "Minyoung goes quiet. Her black black eyes get watery. You feel like you missed something 😭",
        angry: "Minyoung's voice gets louder and louder... uh-oh, she's getting upset!",
        neutral: "Minyoung is... watching you."
      }[finalMood];

      speak(reaction);
    });

    actions.appendChild(btn);
  });

  const skip = document.createElement("button");
  skip.className = "btn ghost";
  skip.innerText = "Ignore (risky)";
  skip.addEventListener("click", () => {
    closePopup();
    touchAction();
    speak("You ignored the moment. The universe is taking notes.");
  });
  actions.appendChild(skip);

  modal.classList.remove("hidden");
}

function closePopup() {
  $("modal").classList.add("hidden");
}

/***********************
  ✅ Item effect popup (shop feedback)
************************/
function openItemPopup(item, affectionGained) {
  const modal = $("modal");

  const lines = [];
  lines.push(`${item.name}`);
  lines.push(``);
  lines.push(`💗 Affection gained: +${affectionGained}`);

  if (item.id === "perfume") lines.push(`✨ Buff: +10% affection gains (passive)`);
  if (item.id === "tennisBall") lines.push(`✨ Buff: 30% chance bad moments become funny memories`);
  if (item.id === "foreheadBlanket") lines.push(`✨ Unlock: Safe & Sleepy`);
  if (item.id === "koreanFeast") lines.push(`✨ Buff: Homebody Harmony (sad/angry outcomes less likely)`);
  if (item.id === "tornadoFudge") lines.push(`✨ Buff: Tornado Edition (more flips to neutral/happy, more chaos popups)`);
  if (item.id === "goofyNate") lines.push(`✨ Buff: My Favorite Person (happy outcomes boosted)`);

  if (item.unique) lines.push(`🌟 Unique item acquired!`);

  $("modalTitle").innerText = "✨ Gift Effect";
  $("modalText").innerText = lines.join("\n");

  const actions = $("modalActions");
  actions.innerHTML = "";

  const ok = document.createElement("button");
  ok.className = "btn";
  ok.innerText = "Aww 💕";
  ok.addEventListener("click", () => closePopup());
  actions.appendChild(ok);

  modal.classList.remove("hidden");
}

/***********************
  HUD
************************/
function renderHUD() {
  enforceCheats();

  $("hearts").innerText =
  state.cheats?.unlimitedHearts || !Number.isFinite(state.hearts)
    ? "∞"
    : String(state.hearts);

$("affection").innerText =
  state.cheats?.unlimitedAffection || !Number.isFinite(state.affection)
    ? "∞"
    : String(state.affection);

  $("stage").innerText = state.stage;
  $("mood").innerText = state.mood;

  $("stageLabel").innerText = STAGE_LABELS[state.stage] || `Stage ${state.stage}`;

  const passives = [];
  if (state.flags.perfume) passives.push("Perfume passive: +10% affection gains");
  if (state.flags.tennisBall) passives.push("Tennis Ball passive: some bad moments become funny memories");
  if (state.flags.safeSleepy) passives.push("Forehead Blanket: Safe & Sleepy unlocked");
  if (state.flags.tornadoFudge) passives.push("Tornado Fudge: chaos memories boosted");
  if (state.flags.goofyNate) passives.push("Goofy Nate: happy outcomes boosted");
  if (state.cheats?.unlimitedHearts) passives.push("DEV: Unlimited Hearts");
  if (state.cheats?.unlimitedAffection) passives.push("DEV: Unlimited Affection");
  $("passivesNote").innerText = passives.join(" • ");

  const inv = $("inventoryList");
  inv.innerHTML = "";
  if (state.inventory.length === 0) {
    inv.innerHTML = `<span class="small">No items yet. Nate, go spoil her 😌</span>`;
  } else {
    state.inventory
      .slice()
      .reverse()
      .forEach((name) => {
        const pill = document.createElement("div");
        pill.className = "pill";
        pill.innerText = name;
        inv.appendChild(pill);
      });
  }

  updateSprite();
}

/***********************
  SHOP (hidden affection values)
************************/
const SHOP_ITEMS = [
  {
    id: "perfume",
    name: `🐾 “Drake Memory” Perfume (Anal Glands Scented)`,
    cost: 150,
    affectionHidden: 75,
    type: "Soul Item",
    desc: `A ridiculously strong scent that somehow smells just like when Drake's anal gland was leaking.
When worn, Minyoung gains the passive ability “Love That Never Leaves,” increasing all affection gains by 10% for the rest of the year.`,
    flavor: `"Some loves don’t fade. They just linger."`,
    unique: true,
    onBuy() {
      state.flags.perfume = true;
      state.affectionMult = 1.1;
    }
  },
  {
    id: "tennisBall",
    name: `🎾 Fudge’s Blessed Tennis Ball`,
    cost: 100,
    affectionHidden: 65,
    type: "Companion Relic",
    desc: `Slightly slobbery. Extremely bouncy. Holding it instantly restores Minyoung’s mood and prevents one bad day per month.

Special Ability: Unlocks “Golden Retriever Energy”
→ negative events have a 30% chance to turn into funny memories.`,
    flavor: `"Joy is loud, neon, and covered in dog hair."`,
    unique: true,
    onBuy() {
      state.flags.tennisBall = true;
    }
  },
  {
    id: "persimmon",
    name: `🌅 Perfectly Ripe Persimmon (감)`,
    cost: 30,
    affectionHidden: 30,
    type: "Seasonal Treasure",
    desc: `Honey-sweet and nostalgic. Eating it grants a temporary buff called Autumn Heart, making Minyoung extra reflective and affectionate.

Hidden Effect:
If gifted unexpectedly → something good might happen.`,
    flavor: `"Sweetness arrives so intensely."`,
    unique: false,
    onBuy() {
      if (Math.random() < 0.3) state.affection += 10;
    }
  },
  {
    id: "squid",
    name: `🦑 Dangerously Addictive Dried Squid (가문어)`,
    cost: 30,
    affectionHidden: 30,
    type: "Snack Buff",
    desc: `Chewy, savory, impossible to stop eating. Restores energy after long workdays.`,
    flavor: `"Just one more bite… probably."`,
    unique: false,
    onBuy() {
      state.flags.squid = true;
    }
  },
  {
    id: "dinner",
    name: `🥡 “I Brought You Dinner”`,
    cost: 25,
    affectionHidden: 40,
    type: "Couple Move",
    desc: `Shows up with your favorite takeout after a long day without being asked.

Hidden Bonus:
If he remembered the exact order…`,
    flavor: `"You looked tired. So I handled dinner."`,
    unique: false,
    onBuy() {
      if (Math.random() < 0.35) state.affection += 5;
    }
  },
  {
    id: "coffee",
    name: `☕ Morning Coffee Delivery`,
    cost: 15,
    affectionHidden: 30,
    type: "Couple Move",
    desc: `A warm cup placed gently next to you before you fully wake up.

Passive Effect:
Reduces morning grumpiness.`,
    flavor: `"You don’t have to open your eyes yet."`,
    unique: false
  },
  {
    id: "couch",
    name: `🛋️ Couch Cuddle`,
    cost: 5,
    affectionHidden: 20,
    type: "Cozy",
    desc: `No phones. No scrolling. Just leaning into each other.`,
    flavor: `"Nothing happened. And it was perfect."`,
    unique: false
  },
  {
    id: "sawThis",
    name: `📦 “Saw This and Thought of You”`,
    cost: 5,
    affectionHidden: 30,
    type: "Thoughtful",
    desc: `A small, random object that proves you live in his brain.`,
    flavor: `"It had your energy."`,
    unique: false,
    onBuy() {
      state.affection += Math.floor(Math.random() * 9);
    }
  },
  {
    id: "fruit",
    name: `🍓 Fruit Cut Into Perfect Pieces`,
    cost: 30,
    affectionHidden: 20,
    type: "Care",
    desc: `Was it necessary? No. Did he do it anyway? Yes.`,
    flavor: `"Eat. I know you forget."`,
    unique: false,
    onBuy() {
      if (Math.random() < 0.5) state.affection += 4;
    }
  },
  {
    id: "lastOne",
    name: `🍪 Saved You the Last One`,
    cost: 5,
    affectionHidden: 5,
    type: "Trust",
    desc: `The final cookie. Untouched. Protected from himself.`,
    flavor: `"I was tempted. Be proud."`,
    unique: false
  },
  {
    id: "photo",
    name: `📸 “You Look Cute, Don’t Move” Photo`,
    cost: 20,
    affectionHidden: 50,
    type: "Memory",
    desc: `You insist you look chaotic. She insists you look perfect.`,
    flavor: `"I want to remember this version of you."`,
    unique: false
  },
  {
    id: "foreheadKiss",
    name: `💤 Forehead Kiss`,
    cost: 20,
    affectionHidden: 75,
    type: "Security",
    desc: `Gentle. Unrushed. Usually when you least expect it.`,
    flavor: `"Right here is my favorite place."`,
    unique: false
  },
  {
    id: "foreheadBlanket",
    name: `🌙 Forehead Blanket`,
    cost: 100,
    affectionHidden: 200,
    type: "Cozy Item",
    desc: `A gentle hand rests across your forehead, shielding your eyes from the world.

Primary Effect:
Activates “Safe & Sleepy”.`,
    flavor: `"Rest. I’ve got the watch."`,
    unique: true,
    onBuy() {
      state.flags.safeSleepy = true;
    }
  },
  {
    id: "koreanFeast",
    name: `🍚 “Korean Feast”`,
    cost: 60,
    affectionHidden: 100,
    type: "Korean Food Buff",
    desc: `A full, comforting Korean meal that hits like a hug: warm rice, soup, seven side dishes, and that “everything is okay” feeling.

Hidden Effect:
Activates “Homebody Harmony”
→ sad/angry outcomes become less likely for a while
→ chance to trigger a soft extra popup`,
    flavor: `“Korean food always makes her feel better.”`,
    unique: false,
    onBuy() {
      state.buffKoreanFeast = Math.max(state.buffKoreanFeast, 6);
      setMood("happy", { persist: true });
    }
  },
  {
    id: "tornadoFudge",
    name: `🌪️🐶 “Spinning Fudge” Tornado Dog Show Ticket`,
    cost: 80,
    affectionHidden: 20,
    type: "Chaos Entertainment",
    desc: `A front-row ticket to the show where Fudge does his signature move: spinning in circles until physics begs for mercy.

Hidden Effect:
Unlocks “Golden Retriever Energy: Tornado Edition”
→ negative outcomes are more likely to flip into funny memories
→ sometimes adds an extra surprise popup`,
    flavor: `“He’s not spinning. He’s rebranding the atmosphere.”`,
    unique: true,
    onBuy() {
      state.buffTornadoFudge = Math.max(state.buffTornadoFudge, 8);
      state.flags.tornadoFudge = true;
    }
  },
  {
    id: "goofyNate",
    name: `🎭 “Goofy Nate Extravaganza” (One-Man Comedy Tour)`,
    cost: 20,
    affectionHidden: 75,
    type: "Partner Skill Upgrade",
    desc: `A fully produced evening where Nate commits to the bit with alarming dedication.

Hidden Effect:
Activates “My Favorite Person”
→ happy outcomes become more likely in popups
→ sometimes adds a tiny extra romantic line after mini games`,
    flavor: `“I’m not embarrassed. I’m in love.”`,
    unique: true,
    onBuy() {
      state.buffGoofyNate = Math.max(state.buffGoofyNate, 10);
      state.flags.goofyNate = true;
    }
  }
];

function renderShop() {
  const root = $("shopList");
  root.innerHTML = "";

  SHOP_ITEMS.forEach((item) => {
    const ownedUnique = item.unique && state.inventory.includes(item.name);

    const el = document.createElement("div");
    el.className = "shop-item";
    el.innerHTML = `
      <div class="shop-top">
        <div>
          <div class="shop-name">${item.name}</div>
          <div class="shop-meta">
            <div><strong>Type:</strong> ${item.type}</div>
            <div class="small" style="margin-top:6px; white-space:pre-line;">${item.desc}</div>
            <div class="small" style="margin-top:6px;"><em>${item.flavor}</em></div>
          </div>
        </div>
        <div class="shop-actions">
          <div class="cost">Cost: 💗 ${item.cost}</div>
          <button class="btn ${ownedUnique ? "ghost" : ""}" ${ownedUnique ? "disabled" : ""} data-buy="${item.id}">
            ${ownedUnique ? "Owned" : "Buy"}
          </button>
        </div>
      </div>
    `;
    root.appendChild(el);
  });

  root.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => buyItem(btn.getAttribute("data-buy")));
  });
}

function buyItem(id) {
  touchAction();

  const item = SHOP_ITEMS.find((x) => x.id === id);
  if (!item) return;

  const ownedUnique = item.unique && state.inventory.includes(item.name);
  if (ownedUnique) return;

  // ✅ Unlimited hearts bypasses cost checks/deductions
  if (!state.cheats?.unlimitedHearts) {
    if (state.hearts < item.cost) {
      speak("Not enough hearts 😭 Go play mini games and come back.");
      return;
    }
    state.hearts -= item.cost;
  }

  const hidden = item.affectionHidden ?? 0;
  const boosted = Math.round(hidden * (state.affectionMult || 1));
  state.affection += boosted;

  state.inventory.push(item.name);
  if (typeof item.onBuy === "function") item.onBuy();

  setMood("happy", { persist: true });
  speak("Minyoung received a gift… and her mood instantly improved 💗");

  enforceCheats();
  save();
  recomputeStage();
  renderHUD();
  renderShop();

  openItemPopup(item, boosted);
}

/***********************
  NAV
************************/
$("btnMiniGames").addEventListener("click", () => {
  touchAction();
  showView("minigames");
});

$("btnShop").addEventListener("click", () => {
  touchAction();
  renderShop();
  showView("shop");
});

$("btnReset").addEventListener("click", () => {
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});

document.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => {
    touchAction();
    const where = btn.getAttribute("data-nav");
    if (where === "home") {
      showView("home");
      renderHUD();

      // greet popup sometimes
      if (Math.random() < 0.25) maybePopup("home");

      // if there's a pending trial/ending available, offer it (with entry popup)
      recomputeStage();
    }
  });
});

/***********************
  MINI GAMES
************************/
let stopCurrentGame = null;

$("btnQuitGame").addEventListener("click", () => {
  touchAction();
  if (stopCurrentGame) stopCurrentGame();
  stopCurrentGame = null;

  // if quitting a trial/ending, cooldown avoids instant loop
  if (isTrialRunning || isEndingRunning) state.trialCooldownUntil = Date.now() + 4000;

  isMiniGameRunning = false;
  isTrialRunning = false;
  isEndingRunning = false;

  save();
  showView("minigames");
});

document.querySelectorAll("[data-game]").forEach((btn) => {
  btn.addEventListener("click", () => startGame(btn.getAttribute("data-game")));
});

function startGame(key) {
  touchAction();
  isMiniGameRunning = true;

  showView("game");
  const area = $("gameArea");
  area.innerHTML = "";
  stopCurrentGame = null;
  finalizeCurrentGame = null;

  if (key === "catch") return gameCatch(area);
  if (key === "pop") return gamePop(area);
  if (key === "memory") return gameMemory(area);
  if (key === "react") return gameReact(area);
  if (key === "dino") return gameDino(area);

  // NEW games
  if (key === "quiz") return gameQuiz(area);
  if (key === "tetris") return gameTetris(area);
  if (key === "hangman") return gameHangman(area);
}

/* Game 1: Catch the Hearts */
function gameCatch(root) {
  $("gameTitle").innerText = "💗 Catch the Hearts";
  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Move with <span class="kbd">←</span> <span class="kbd">→</span> • 20 seconds</div>
        <div><strong id="catchScore">0</strong> caught</div>
      </div>
      <canvas class="canvas" id="catchCanvas" width="720" height="360"></canvas>
      <div class="center small" style="margin-top:10px;" id="catchMsg"></div>
    </div>
  `;

  const c = $("catchCanvas");
  const ctx = c.getContext("2d");
  let running = true;
  let tLeft = 20000;
  let last = performance.now();
  let score = 0;

  const basket = { x: 360, y: 300, w: 110, h: 22, vx: 0 };
  const hearts = [];
  const spawnEvery = 420;
  let spawnTimer = 0;

  function spawn() {
    hearts.push({ x: Math.random() * (c.width - 20) + 10, y: -10, r: 10, vy: 100 + Math.random() * 140 });
  }

  function drawHeart(x, y, r) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, r / 2);
    ctx.bezierCurveTo(-r, -r / 2, -r, r, 0, r * 1.6);
    ctx.bezierCurveTo(r, r, r, -r / 2, 0, r / 2);
    ctx.fillStyle = "rgba(255,77,136,.95)";
    ctx.fill();
    ctx.restore();
  }

  function loop(now) {
    if (!running) return;
    const dt = (now - last) / 1000;
    last = now;
    tLeft -= dt * 1000;

    spawnTimer += dt * 1000;
    if (spawnTimer >= spawnEvery) {
      spawnTimer = 0;
      spawn();
    }

    basket.x += basket.vx * dt;
    basket.x = Math.max(0, Math.min(c.width - basket.w, basket.x));

    for (const h of hearts) {
      h.y += h.vy * dt;

      const hit =
        h.x > basket.x &&
        h.x < basket.x + basket.w &&
        h.y + h.r > basket.y &&
        h.y - h.r < basket.y + basket.h;

      if (hit) {
        score += 1;
        h.y = 9999;
      }
    }

    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.fillStyle = "rgba(255,111,165,.95)";
    ctx.fillRect(basket.x, basket.y, basket.w, basket.h);
    ctx.fillRect(basket.x + 12, basket.y - 12, basket.w - 24, 12);

    for (const h of hearts) drawHeart(h.x, h.y, h.r);

    for (let i = hearts.length - 1; i >= 0; i--) {
      if (hearts[i].y > c.height + 30) hearts.splice(i, 1);
      else if (hearts[i].y > 9000) hearts.splice(i, 1);
    }

    $("catchScore").innerText = score;

    if (tLeft <= 0) return end();
    requestAnimationFrame(loop);
  }

  function end() {
    running = false;
    isMiniGameRunning = false;

    const heartsEarned = clamp(score * 2, 5, 40);
    const affectionEarned = Math.max(2, Math.round(score * 1.2));
    addRewards(heartsEarned, affectionEarned);

    $("catchMsg").innerText = `Result: +${heartsEarned} hearts 💗`;
    speak("Minyoung: “Okay wait… that was kind of awesome.”");

    if (score >= 10) setMood("happy", { persist: true });
    else if (score <= 2 && Math.random() < 0.35) setMood("sad", { persist: true });

    if (state.buffGoofyNate > 0 && Math.random() < 0.35) {
      speak("Minyoung: “Why do I feel so proud of you right now.”");
    }

    maybePopup("afterGame");
  }

  function onKey(e) {
    touchAction();
    if (e.key === "ArrowLeft") basket.vx = -300;
    if (e.key === "ArrowRight") basket.vx = 300;
  }
  function onKeyUp(e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") basket.vx = 0;
  }

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);

  stopCurrentGame = () => {
    running = false;
    isMiniGameRunning = false;
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKeyUp);
  };

  requestAnimationFrame(loop);
}

/* Game 2: Pop the Hearts */
function gamePop(root) {
  $("gameTitle").innerText = "🫧 Pop the Hearts";
  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Click hearts • 15 seconds</div>
        <div>Popped: <strong id="popScore">0</strong></div>
      </div>
      <div id="popField" style="position:relative; height:360px; border-radius:16px; border:1px dashed rgba(255,77,136,.35); background:rgba(255,255,255,.65); overflow:hidden; margin-top:10px;"></div>
      <div class="center small" style="margin-top:10px;" id="popMsg"></div>
    </div>
  `;

  let running = true;
  let score = 0;
  const field = $("popField");

  function spawnHeart() {
    if (!running) return;
    const h = document.createElement("button");
    h.style.position = "absolute";
    h.style.left = `${Math.random() * 88 + 2}%`;
    h.style.top = `${Math.random() * 72 + 8}%`;
    h.style.border = "none";
    h.style.background = "transparent";
    h.style.cursor = "pointer";
    h.style.fontSize = `${Math.random() * 18 + 22}px`;
    h.innerText = Math.random() < 0.85 ? "💗" : "💖";
    h.addEventListener("click", () => {
      if (!running) return;
      touchAction();
      score++;
      $("popScore").innerText = String(score);
      h.remove();
    });
    field.appendChild(h);
    setTimeout(() => h.remove(), 900);
  }

  const spawnInterval = setInterval(spawnHeart, 250);
  const timer = setTimeout(() => end(), 15000);

  function end() {
    running = false;
    isMiniGameRunning = false;

    clearInterval(spawnInterval);
    clearTimeout(timer);
    field.querySelectorAll("button").forEach((b) => b.remove());

    const heartsEarned = clamp(score * 3, 6, 45);
    const affectionEarned = Math.max(2, Math.round(score * 1.4));
    addRewards(heartsEarned, affectionEarned);

    $("popMsg").innerText = `Result: +${heartsEarned} hearts 💗`;
    speak("Minyoung: “Why was that actually addictive.”");

    if (score >= 12) setMood("happy", { persist: true });
    else if (score <= 3 && Math.random() < 0.25) setMood("angry", { persist: true });

    if (state.buffGoofyNate > 0 && Math.random() < 0.35) {
      speak("Minyoung: “Okay… that was kinda cute. Do it again.”");
    }

    maybePopup("afterGame");
  }

  stopCurrentGame = () => {
    running = false;
    isMiniGameRunning = false;
    clearInterval(spawnInterval);
    clearTimeout(timer);
  };
}

/* Game 3: Memory Match */
function gameMemory(root) {
  $("gameTitle").innerText = "🃏 Memory Match";

  const icons = ["💗", "🍓", "🐾", "🍲", "🎾", "🌙", "📸", "🦑"];
  const deck = [...icons, ...icons].sort(() => Math.random() - 0.5);

  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Match all pairs</div>
        <div>Matches: <strong id="memMatches">0</strong>/8</div>
      </div>
      <div id="memGrid" style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:12px;"></div>
      <div class="center small" style="margin-top:10px;" id="memMsg"></div>
    </div>
  `;

  const grid = $("memGrid");
  let first = null;
  let lock = false;
  let matches = 0;
  let misses = 0;
  let finished = false;

  function makeCard(i) {
    const btn = document.createElement("button");
    btn.className = "tile";
    btn.style.textAlign = "center";
    btn.style.fontSize = "22px";
    btn.style.padding = "16px 10px";
    btn.dataset.val = deck[i];
    btn.dataset.open = "0";
    btn.innerText = "❔";
    btn.addEventListener("click", () => {
      touchAction();
      onFlip(btn);
    });
    return btn;
  }

  function onFlip(card) {
    if (finished) return;
    if (lock) return;
    if (card.dataset.open === "1") return;

    card.dataset.open = "1";
    card.innerText = card.dataset.val;

    if (!first) {
      first = card;
      return;
    }

    if (first.dataset.val === card.dataset.val) {
      matches++;
      $("memMatches").innerText = String(matches);
      first = null;
      if (matches >= 8) end();
      return;
    }

    misses++;
    lock = true;
    setTimeout(() => {
      first.dataset.open = "0";
      first.innerText = "❔";
      card.dataset.open = "0";
      card.innerText = "❔";
      first = null;
      lock = false;
    }, 700);
  }

  deck.forEach((_, i) => grid.appendChild(makeCard(i)));

  function end() {
    if (finished) return;
    finished = true;
    isMiniGameRunning = false;

    const heartsEarned = 40;
    const affectionEarned = 18;
    addRewards(heartsEarned, affectionEarned);

    $("memMsg").innerText = `Cleared: +${heartsEarned} hearts 💗`;
    speak("Minyoung: “You remembered the tiny things. That’s… unfairly cute.”");

    if (misses <= 6) setMood("happy", { persist: true });
    else if (misses >= 14 && Math.random() < 0.35) setMood("sad", { persist: true });

    if (state.buffGoofyNate > 0 && Math.random() < 0.35) {
      speak("Minyoung: “Stop. That was romantic. Don’t look at me.”");
    }

    maybePopup("afterGame");
  }

  stopCurrentGame = () => {
    isMiniGameRunning = false;
    finished = true;
  };
}

/* Game 4: Reaction Heart */
function gameReact(root) {
  $("gameTitle").innerText = "⚡ Reaction Heart";

  let round = 0;
  let score = 0;
  let canClick = false;
  let running = true;
  let timeoutId = null;

  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Click only when the heart turns 💗 (5 rounds)</div>
        <div>Wins: <strong id="reactScore">0</strong></div>
      </div>

      <div class="center" style="margin-top:16px;">
        <button id="reactBtn" style="font-size:44px; background:transparent; border:none; cursor:pointer;">🤍</button>
      </div>

      <div class="center small" id="reactMsg" style="margin-top:10px;"></div>
    </div>
  `;

  const btn = $("reactBtn");
  const msg = $("reactMsg");

  function nextRound() {
    if (!running) return;
    round++;
    canClick = false;
    btn.innerText = "🤍";
    msg.innerText = `Round ${round}/5… wait for it…`;

    const delay = 900 + Math.random() * 1800;
    timeoutId = setTimeout(() => {
      canClick = true;
      btn.innerText = "💗";
      msg.innerText = "NOW!";

      timeoutId = setTimeout(() => {
        if (canClick) {
          canClick = false;
          msg.innerText = "Too slow 😭";
          setTimeout(() => {
            if (round >= 5) end();
            else nextRound();
          }, 700);
        }
      }, 650);
    }, delay);
  }

  btn.addEventListener("click", () => {
    touchAction();
    if (!running) return;
    if (canClick) {
      score++;
      $("reactScore").innerText = String(score);
      canClick = false;
      msg.innerText = "Nice 😌";
      clearTimeout(timeoutId);
      setTimeout(() => {
        if (round >= 5) end();
        else nextRound();
      }, 650);
    } else {
      msg.innerText = "False start… suspicious 😭";
    }
  });

  function end() {
    running = false;
    isMiniGameRunning = false;

    clearTimeout(timeoutId);

    const heartsEarned = 12 + score * 8;
    const affectionEarned = 6 + score * 3;
    addRewards(heartsEarned, affectionEarned);

    msg.innerText = `Result: +${heartsEarned} hearts 💗`;
    speak("Minyoung: “Your reflexes are… like Fudge playing fetch.”");

    if (score >= 4) setMood("happy", { persist: true });
    else if (score <= 1 && Math.random() < 0.35) setMood("sad", { persist: true });

    if (state.buffGoofyNate > 0 && Math.random() < 0.35) {
      speak("Minyoung: “Okay… that was impressive. I hate that I’m smiling.”");
    }

    maybePopup("afterGame");
  }

  stopCurrentGame = () => {
    running = false;
    isMiniGameRunning = false;
    clearTimeout(timeoutId);
  };

  nextRound();
}

/* Game 5: Minyoung Dino Run */
function gameDino(root) {
  touchAction();
  $("gameTitle").innerText = "🦖 Run, Cuddlosaurus!";

  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Jump with <span class="kbd">Space</span> or <span class="kbd">↑</span> • tap/click canvas • infinite</div>
        <div>Score: <strong id="dinoScore">0</strong></div>
      </div>
      <canvas class="canvas" id="dinoCanvas" width="720" height="360"></canvas>
      <div class="center small" style="margin-top:10px;" id="dinoMsg"></div>
    </div>
  `;

  const MAX_HEARTS = 60;
  const MAX_AFFECTION = 28;

  const canvas = $("dinoCanvas");
  const ctx = canvas.getContext("2d");

  let audioCtx = null;
  function beep(freq = 520, dur = 0.06, type = "triangle", gain = 0.03) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch {}
  }
  function boing() {
    beep(520, 0.04, "triangle", 0.03);
    beep(740, 0.05, "sine", 0.02);
  }

  let running = true;
  let last = performance.now();

  let score = 0;
  let speed = 220;
  let spawnTimer = 0;
  let nextSpawnMs = 900;

  const groundY = 260;

  const sprite = new Image();
  sprite.src = `assets/characters/stage${clampStage(state.stage)}-neutral.png?v=${SPRITE_VERSION}`;

  const player = { x: 90, y: groundY, w: 52, h: 60, vy: 0, onGround: true };

  const trail = [];
  function addTrail() {
    trail.push({
      x: player.x + 6,
      y: player.y + 22,
      vx: -50 - Math.random() * 40,
      vy: -10 + Math.random() * 20,
      life: 0.9,
      size: 16 + Math.random() * 10,
      emoji: Math.random() < 0.5 ? "💗" : "💞"
    });
  }

  const obs = [];
  function obstacleSetForStage(stage) {
    if (stage === 1) return ["💘", "🐶", "🧸"];
    if (stage === 2) return ["🐕", "💘", "💞"];
    if (stage === 3) return ["☕", "🦑", "💘"];
    return ["🍕", "💘", "🐶"];
  }
  const obstacleEmojis = obstacleSetForStage(clampStage(state.stage));

  let finalized = false;
  finalizeCurrentGame = () => {
    if (finalized) return;
    finalized = true;

    const heartsEarned = clamp(Math.round(score / 12) + 10, 10, MAX_HEARTS);
    const affectionEarned = clamp(Math.round(score / 25) + 6, 6, MAX_AFFECTION);
    addRewards(heartsEarned, affectionEarned);

    $("dinoMsg").innerText = `Quit: +${heartsEarned} hearts 💗 (max ${MAX_HEARTS})`;
    speak("Minyoung: “Okay wait… I’m kind of athletic?”");

    if (score >= 240) setMood("happy", { persist: true });

    if (state.buffGoofyNate > 0 && Math.random() < 0.45) {
      speak("Minyoung: “I’m smiling. Don’t talk.”");
    }

    maybePopup("afterGame");
  };

  function jump() {
    if (!running) return;
    if (!player.onGround) return;
    touchAction();
    player.vy = -460;
    player.onGround = false;
    boing();
    for (let i = 0; i < 6; i++) addTrail();
  }

  function spawnObstacle() {
    const isTall = Math.random() < 0.35;
    const emoji = obstacleEmojis[Math.floor(Math.random() * obstacleEmojis.length)];
    obs.push({
      x: canvas.width + 20,
      y: groundY + (isTall ? -16 : 2),
      w: isTall ? 22 : 18,
      h: isTall ? 44 : 34,
      kind: isTall ? "tall" : "short",
      emoji
    });
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function drawBackground() {
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(255,77,136,.50)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, groundY + player.h);
    ctx.lineTo(canvas.width, groundY + player.h);
    ctx.stroke();

    ctx.globalAlpha = 0.22;
    ctx.font = "18px ui-monospace, system-ui";
    ctx.fillText("💗", 90, 60);
    ctx.fillText("💞", 240, 40);
    ctx.fillText("💖", 420, 70);
    ctx.fillText("💘", 560, 52);
    ctx.globalAlpha = 1;
  }

  function drawTrail(dt) {
    for (let i = trail.length - 1; i >= 0; i--) {
      const p = trail[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 24 * dt;
      if (p.life <= 0) {
        trail.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = `${Math.floor(p.size)}px ui-monospace, system-ui`;
      ctx.fillText(p.emoji, p.x, p.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawPlayer() {
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.ellipse(player.x + player.w / 2, groundY + player.h + 10, 18, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.globalAlpha = 1;

    if (sprite.complete && sprite.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, player.x, player.y, player.w, player.h);
    } else {
      ctx.fillStyle = "rgba(255,77,136,.9)";
      ctx.fillRect(player.x, player.y, player.w, player.h);
    }
  }

  function drawObstacles() {
    obs.forEach((o) => {
      const size = o.kind === "tall" ? 28 : 24;
      ctx.font = `${size}px ui-monospace, system-ui`;
      ctx.fillText(String(o.emoji), o.x - 2, o.y + o.h);
    });
  }

  function loop(now) {
    if (!running) return;
    const dt = (now - last) / 1000;
    last = now;

    speed += dt * 7;

    spawnTimer += dt * 1000;
    if (spawnTimer >= nextSpawnMs) {
      spawnTimer = 0;
      spawnObstacle();
      nextSpawnMs = 680 + Math.random() * 680;
    }

    const gravity = 1250;
    player.vy += gravity * dt;
    player.y += player.vy * dt;

    if (player.y >= groundY) {
      player.y = groundY;
      player.vy = 0;
      player.onGround = true;
    }

    for (const o of obs) o.x -= speed * dt;

    for (let i = obs.length - 1; i >= 0; i--) {
      if (obs[i].x + obs[i].w < -30) obs.splice(i, 1);
    }

    score += dt * 12;
    $("dinoScore").innerText = String(Math.floor(score));

    if (!player.onGround && Math.random() < 0.85) addTrail();
    if (player.onGround && Math.random() < 0.08) addTrail();

    const pHitbox = { x: player.x + 10, y: player.y + 10, w: player.w - 20, h: player.h - 16 };
    for (const o of obs) {
      const oHitbox = { x: o.x, y: o.y + 8, w: o.w + 10, h: o.h - 10 };
      if (rectsOverlap(pHitbox, oHitbox)) {
        // instead of ending the game, just “bonk” and reset score a bit
        score = Math.max(0, score - 60);
        if (Math.random() < 0.45) setMood("sad", { persist: true });
      }
    }

    const projected = clamp(Math.round(score / 12) + 10, 10, MAX_HEARTS);
    $("dinoMsg").innerText =
      projected >= MAX_HEARTS
        ? `Max rewards reached (${MAX_HEARTS}). Keep running 😌`
        : `Quit anytime to claim rewards (up to ${MAX_HEARTS} hearts).`;

    drawBackground();
    drawTrail(dt);
    drawObstacles();
    drawPlayer();

    requestAnimationFrame(loop);
  }

  function onKey(e) {
    if (e.code === "Space" || e.key === "ArrowUp") {
      e.preventDefault();
      jump();
    }
  }
  function onTap() {
    jump();
  }

  function cleanup() {
    window.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointerdown", onTap);
  }

  window.addEventListener("keydown", onKey);
  canvas.addEventListener("pointerdown", onTap);

  stopCurrentGame = () => {
    running = false;
    isMiniGameRunning = false;
    finalizeCurrentGame = null;
    cleanup();
  };

  requestAnimationFrame(loop);
}


/* Game X: Minyoung Quiz (no timer, capped rewards) */
function gameQuiz(root) {
  touchAction();
  $("gameTitle").innerText = "🧠 Minyoung Quiz";

  // You can edit/replace these questions anytime
const quizData = [
  {
    question: "What’s my favorite movie genre?",
    options: [
      "Psychological thriller",
      "Apocalypse / disaster movies",
      "True crime documentaries",
      "Comedy"
    ],
    answer: "Apocalypse / disaster movies",
  },
  {
    question: "What is my height in cm?",
    options: ["157", "158", "159", "161"],
    answer: "158",
  },
  {
    question: "What are the names of my cats?",
    options: [
      "Hibon & Sebon",
      "Heebon & Saebon",
      "Hibon & Sebon",
      "Haebon & Saebon"
    ],
    answer: "Heebon & Saebon",
  },
  {
    question: "In what year did I graduate high school?",
    options: ["2010", "2011", "2012", "2013"],
    answer: "2012",
  },
  {
    question: "What is my title at work?",
    options: [
      "Director of Data Analytics",
      "Director of Data and Evaluation",
      "Head of Data and Insights",
      "Director of Data and Research"
    ],
    answer: "Director of Data and Evaluation",
  },
  {
    question: "Where have we NOT been on Valentine’s Day?",
    options: ["Washington DC", "Honolulu", "Singapore", "Venice"],
    answer: "Venice",
  },
  {
    question: "What was the name of the Valentine’s retreat we took in 2019?",
    options: ["Lake Geneva", "Clam Lake", "Cedar Lake", "Clam County"],
    answer: "Clam Lake",
  },
  {
    question: "What was the first Valentine’s Day gift I gave you?",
    options: [
      "Chocolate chip cookies",
      "Dried fruit chocolate bark",
      "Chocolate-covered strawberries",
      "Chocolate from Paris"
    ],
    answer: "Dried fruit chocolate bark",
  },
  {
    question: "As of 2026, what is Fudge’s vitamin brand?",
    options: ["Zesty Paws", "Dog is Human", "Native Pet", "Pet Honesty"],
    answer: "Dog is Human",
  },
  {
    question: "What color was the first winter jacket I bought Drake in 2017?",
    options: ["Navy", "Grey", "Forest green", "Burgundy"],
    answer: "Grey",
  },
  {
    question: "What was my favorite flavor at Pumphouse Creamery in Minneapolis?",
    options: ["Cookies & Cream", "Cherry", "Seven Layers Bar", "Strawberry basil"],
    answer: "Cherry",
  },
  {
    question: "What is the name of the dog bath place Drake and I used to go to?",
    options: ["Bubble Paws", "Bubbly Paws", "Bubbly Wash", "Bubbly Dogs"],
    answer: "Bubbly Paws",
  },
  {
    question: "One day, Drake rolled in ______, and I screamed and rushed him to the bath place.",
    options: ["Goose poop", "Dead squirrel", "Mystery swamp mud", "Rotting leaves"],
    answer: "Dead squirrel",
  },
  {
    question: "What is the name of the cigarettes I used to smoke?",
    options: ["Esse Lights", "Esse Change 1", "Marlboro Ice", "Parliament Aqua"],
    answer: "Esse Change 1",
  },
  {
    question: "I tried bell peppers for the first time in Granada after eating a bell pepper stuffed with…",
    options: ["Chicken Thigh", "Ox tail", "Chorizo", "Seafood"],
    answer: "Ox tail",
  },
  {
    question: "What dish did I eat the MOST repeatedly in Korea last year?",
    options: ["Dakgalbi", "Kimchi jjigae", "Galbi", "Pizza"],
    answer: "Galbi",
  },
  {
    question: "How many days did I stay in Korea in 2025?",
    options: ["47", "52", "54", "62"],
    answer: "54",
  },
  {
    question: "Which weird thing did you not say to me?",
    options: [
      "“I prefer being a mega mandu.”",
      "“I am your bacterial brother.”",
      "“Rub your foot fungus on me.”",
      "“Pop that oxytocin.”"
    ],
    answer: "“Rub your foot fungus on me.”",
  },
];


  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Answer questions • no timer • rewards capped</div>
        <div>Score: <strong id="quizScore">0</strong></div>
      </div>

      <div id="quiz" style="margin-top:12px;"></div>

      <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
        <button class="btn" id="submit">Submit</button>
        <button class="btn ghost" id="retry" style="display:none;">Retry</button>
        <button class="btn ghost" id="showAnswer" style="display:none;">Show answers</button>
      </div>

      <div class="center small" style="margin-top:12px;" id="result"></div>
    </div>
  `;

  const quizContainer = $("quiz");
  const resultContainer = $("result");
  const submitButton = $("submit");
  const retryButton = $("retry");
  const showAnswerButton = $("showAnswer");

  let currentQuestion = 0;
  let score = 0;
  let incorrectAnswers = [];
  let finished = false;

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  function displayQuestion() {
    const questionData = quizData[currentQuestion];

    const questionElement = document.createElement("div");
    questionElement.className = "question";
    questionElement.style.marginBottom = "10px";
    questionElement.style.whiteSpace = "pre-line";
    questionElement.innerHTML = `<strong>${currentQuestion + 1}.</strong> ${questionData.question}`;

    const optionsElement = document.createElement("div");
    optionsElement.className = "options";
    optionsElement.style.display = "grid";
    optionsElement.style.gap = "8px";

    const shuffledOptions = [...questionData.options];
    shuffleArray(shuffledOptions);

    for (let i = 0; i < shuffledOptions.length; i++) {
      const option = document.createElement("label");
      option.className = "option";
      option.style.display = "flex";
      option.style.gap = "8px";
      option.style.alignItems = "center";
      option.style.padding = "10px";
      option.style.borderRadius = "12px";
      option.style.border = "1px dashed rgba(255,77,136,.35)";
      option.style.background = "rgba(255,255,255,.65)";
      option.style.cursor = "pointer";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "quiz";
      radio.value = shuffledOptions[i];

      const optionText = document.createTextNode(shuffledOptions[i]);

      option.appendChild(radio);
      option.appendChild(optionText);
      optionsElement.appendChild(option);
    }

    quizContainer.innerHTML = "";
    quizContainer.appendChild(questionElement);
    quizContainer.appendChild(optionsElement);

    $("quizScore").innerText = String(score);
  }

  function checkAnswer() {
    if (finished) return;
    touchAction();

    const selectedOption = document.querySelector('input[name="quiz"]:checked');
    if (!selectedOption) {
      resultContainer.innerText = "Pick an answer first 🙂";
      return;
    }

    const answer = selectedOption.value;
    if (answer === quizData[currentQuestion].answer) {
      score++;
    } else {
      incorrectAnswers.push({
        question: quizData[currentQuestion].question,
        incorrectAnswer: answer,
        correctAnswer: quizData[currentQuestion].answer,
      });
    }

    currentQuestion++;

    if (currentQuestion < quizData.length) {
      resultContainer.innerText = "";
      displayQuestion();
      $("quizScore").innerText = String(score);
    } else {
      displayResult();
    }
  }

  function displayResult() {
    finished = true;

    // IMPORTANT: end mini game state
    isMiniGameRunning = false;

    quizContainer.style.display = "none";
    submitButton.style.display = "none";
    retryButton.style.display = "inline-block";
    showAnswerButton.style.display = "inline-block";

    const total = quizData.length;
    const pct = total ? score / total : 0;

    // Rewards (capped)
    // You can tune these numbers:
    const heartsEarnedRaw = Math.round(score * 6);       // 0..114
    const affectionEarnedRaw = Math.round(score * 2.2);  // 0..42

    const MAX_HEARTS = 60;      // <- max hearts for this game
    const MAX_AFFECTION = 28;   // <- max affection for this game

    const heartsEarned = clamp(heartsEarnedRaw, 5, MAX_HEARTS);
    const affectionEarned = clamp(affectionEarnedRaw, 2, MAX_AFFECTION);

    addRewards(heartsEarned, affectionEarned);

    resultContainer.innerHTML =
      `You scored <strong>${score}</strong> out of <strong>${total}</strong>.<br>` +
      `Result: +${heartsEarned} hearts 💗`;

    if (pct >= 0.80) {
      setMood("happy", { persist: true });
      speak("Minyoung: “Okay... you definitely know me. I love you!” 😳💗");
    } else if (pct <= 0.6 && Math.random() < 0.80) {
      setMood("sad", { persist: true });
      speak("Minyoung: “Well... I still like you... I guess.” 🥺");
    } else {
      speak("Minyoung: “I hate you!!”");
    }

    maybePopup("afterGame");
  }

  function retryQuiz() {
    touchAction();
    currentQuestion = 0;
    score = 0;
    incorrectAnswers = [];
    finished = false;

    quizContainer.style.display = "block";
    submitButton.style.display = "inline-block";
    retryButton.style.display = "none";
    showAnswerButton.style.display = "none";
    resultContainer.innerHTML = "";

    // Since we restarted, lock mini game again
    isMiniGameRunning = true;

    displayQuestion();
  }

  function showAnswer() {
    touchAction();

    quizContainer.style.display = "none";
    submitButton.style.display = "none";
    retryButton.style.display = "inline-block";
    showAnswerButton.style.display = "none";

    let incorrectAnswersHtml = "";
    for (let i = 0; i < incorrectAnswers.length; i++) {
      incorrectAnswersHtml += `
        <p style="margin:10px 0; padding:10px; border-radius:12px; border:1px dashed rgba(255,77,136,.35); background:rgba(255,255,255,.65);">
          <strong>Q:</strong> ${incorrectAnswers[i].question}<br>
          <strong>You:</strong> ${incorrectAnswers[i].incorrectAnswer}<br>
          <strong>Correct:</strong> ${incorrectAnswers[i].correctAnswer}
        </p>
      `;
    }

    resultContainer.innerHTML = `
      <p>You scored <strong>${score}</strong> out of <strong>${quizData.length}</strong>.</p>
      <p><strong>Incorrect Answers:</strong></p>
      ${incorrectAnswersHtml || "<p>None 💗</p>"}
    `;
  }

  submitButton.addEventListener("click", checkAnswer);
  retryButton.addEventListener("click", retryQuiz);
  showAnswerButton.addEventListener("click", showAnswer);

  stopCurrentGame = () => {
    isMiniGameRunning = false;
    finished = true;
  };

  displayQuestion();
}

/***********************
Tetris
************************

/***********************
  Mini Game: Gift Tetris (replaces Gift Sorting Panic)
  - Uses existing Minyoung Maker aesthetics (game-frame, btn, kbd)
  - Rewards granted at end of run
************************/
function gameTetris(root) {
  touchAction();
  $("gameTitle").innerText = "🎁 Gift Tetris Panic";

  // If you added the HTML block in the page:
  // - show it inside gameArea
  root.innerHTML = "";
  const wrap = document.getElementById("tetrisWrap");
  if (!wrap) {
    root.innerHTML = `<div class="game-frame">Missing #tetrisWrap HTML. Paste the HTML block once into your page.</div>`;
    isMiniGameRunning = false;
    return;
  }
  wrap.classList.remove("hidden");
  root.appendChild(wrap);

  // Elements
  const canvas = document.getElementById("tCanvas");
  const nextBox = document.getElementById("tNext");
  const startBtn = document.getElementById("tStartBtn");
  const restartBtn = document.getElementById("tRestartBtn");
  const msg = document.getElementById("tMsg");
  const scoreEl = document.getElementById("tScore");
  const levelEl = document.getElementById("tLevel");
  const linesEl = document.getElementById("tLines");
  const timeEl = document.getElementById("tTime");

  // Safety reset (in case the user re-enters)
  canvas.innerHTML = "";
  nextBox.innerHTML = "";
  msg.innerText = "Press Start to begin.";
  restartBtn.style.display = "none";

  let running = false;
  let disposed = false;

  // --- Tetris engine (adapted from your snippet, trimmed + safer) ---
  const tetris = {
    board: [],
    pSize: 20,
    canvasHeight: 440,
    canvasWidth: 200,
    boardHeight: 0,
    boardWidth: 0,
    spawnX: 4,
    spawnY: 1,

    shapes: [
      [[-1, 1],[0, 1],[1, 1],[0, 0]],       // T
      [[-1, 0],[0, 0],[1, 0],[2, 0]],       // I
      [[-1,-1],[-1,0],[0,0],[1,0]],         // L
      [[1,-1],[-1,0],[0,0],[1,0]],          // J
      [[0,-1],[1,-1],[-1,0],[0,0]],         // S
      [[-1,-1],[0,-1],[0,0],[1,0]],         // Z
      [[0,-1],[1,-1],[0,0],[1,0]]           // O
    ],

    tempShapes: null,
    curShape: null,
    curShapeIndex: null,
    curX: 0,
    curY: 0,
    curSqs: [],
    nextShape: null,
    nextShapeIndex: null,
    sqs: [],
    score: 0,
    level: 1,
    numLevels: 10,
    time: 0,
    timer: null,
    pTimer: null,
    speed: 700,
    lines: 0,
    isActive: 0,
    curComplete: false,

    // rewards snapshot (for addRewards)
    finalScore: 0,
    finalLines: 0,

    init() {
      running = true;
      this.reset();
      this.initBoard();
      this.initLevelScores();
      this.initShapes();
      this.bindKeyEvents();
      this.play();
      this.initTimer();
      this.renderInfo();
      msg.innerText = "Stack gifts neatly. Don’t overflow 😤";
    },

    reset() {
      this.board = [];
      this.tempShapes = null;
      this.curShape = null;
      this.curShapeIndex = null;
      this.curX = 0;
      this.curY = 0;
      this.curSqs = [];
      this.nextShape = null;
      this.nextShapeIndex = null;
      this.sqs = [];
      this.score = 0;
      this.level = 1;
      this.time = 0;
      this.speed = 700;
      this.lines = 0;
      this.isActive = 0;
      this.curComplete = false;
      this.clearTimers();
      canvas.innerHTML = "";
      nextBox.innerHTML = "";
      this.renderInfo();
    },

    initBoard() {
      this.boardHeight = this.canvasHeight / this.pSize;
      this.boardWidth = this.canvasWidth / this.pSize;
      const s = this.boardHeight * this.boardWidth;
      for (let i = 0; i < s; i++) this.board.push(0);
    },

    initLevelScores() {
      let c = 1;
      for (let i = 1; i <= this.numLevels; i++) {
        this["level" + i] = [c * 1000, 40 * i, 5 * i];
        c = c + c;
      }
    },

    renderInfo() {
      scoreEl.innerText = String(this.score);
      levelEl.innerText = String(this.level);
      linesEl.innerText = String(this.lines);
      timeEl.innerText = String(this.time);
    },

    initShapes() {
      this.curSqs = [];
      this.curComplete = false;
      this.shiftTempShapes();
      this.curShapeIndex = this.tempShapes[0];
      this.curShape = this.shapes[this.curShapeIndex];
      this.initNextShape();
      this.setCurCoords(this.spawnX, this.spawnY);
      this.drawShape(this.curX, this.curY, this.curShape);
    },

    initNextShape() {
      if (typeof this.tempShapes[1] === "undefined") this.initTempShapes();
      this.nextShapeIndex = this.tempShapes[1];
      this.nextShape = this.shapes[this.nextShapeIndex];
      this.drawNextShape();
    },

    initTempShapes() {
      this.tempShapes = [];
      for (let i = 0; i < this.shapes.length; i++) this.tempShapes.push(i);
      let k = this.tempShapes.length;
      while (--k) {
        const j = Math.floor(Math.random() * (k + 1));
        const tmp = this.tempShapes[k];
        this.tempShapes[k] = this.tempShapes[j];
        this.tempShapes[j] = tmp;
      }
    },

    shiftTempShapes() {
      if (!this.tempShapes) this.initTempShapes();
      else this.tempShapes.shift();
    },

    initTimer() {
      const tick = () => {
        if (!running || disposed) return;
        this.time++;
        this.renderInfo();
        this.timer = setTimeout(tick, 2000);
      };
      this.timer = setTimeout(tick, 2000);
    },

    clearTimers() {
      clearTimeout(this.timer);
      clearTimeout(this.pTimer);
      this.timer = null;
      this.pTimer = null;
    },

    setCurCoords(x, y) {
      this.curX = x;
      this.curY = y;
    },

    createSquare(x, y, type) {
      const el = document.createElement("div");
      el.className = "t-square t-type" + type;
      el.style.left = x * this.pSize + "px";
      el.style.top = y * this.pSize + "px";
      return el;
    },

    drawShape(x, y, p) {
      for (let i = 0; i < p.length; i++) {
        const newX = p[i][0] + x;
        const newY = p[i][1] + y;
        this.curSqs[i] = this.createSquare(newX, newY, this.curShapeIndex);
      }
      for (let k = 0; k < this.curSqs.length; k++) canvas.appendChild(this.curSqs[k]);
    },

    drawNextShape() {
      const ns = [];
      for (let i = 0; i < this.nextShape.length; i++) {
        ns[i] = this.createSquare(this.nextShape[i][0] + 2, this.nextShape[i][1] + 2, this.nextShapeIndex);
      }
      nextBox.innerHTML = "";
      for (let k = 0; k < ns.length; k++) nextBox.appendChild(ns[k]);
    },

    removeCur() {
      for (const el of this.curSqs) {
        if (el && el.parentNode === canvas) canvas.removeChild(el);
      }
      this.curSqs = [];
    },

    whichKey(e) {
      return e?.keyCode || e?.which || 0;
    },

    bindKeyEvents() {
      const onKeyDown = (e) => {
        if (!running || disposed) return;
        const c = this.whichKey(e);
        switch (c) {
          case 37: this.move("L"); break;
          case 38: this.move("RT"); break;
          case 39: this.move("R"); break;
          case 40: this.move("D"); break;
          case 27: this.togglePause(); break;
          default: break;
        }
      };

      // Save reference for cleanup
      this._onKeyDown = onKeyDown;
      document.addEventListener("keydown", onKeyDown, false);
    },

    unbindKeyEvents() {
      if (this._onKeyDown) document.removeEventListener("keydown", this._onKeyDown, false);
      this._onKeyDown = null;
    },

    togglePause() {
      if (this.isActive === 1) {
        this.clearTimers();
        this.isActive = 0;
        msg.innerText = "Paused. Press Esc to resume.";
      } else {
        this.play();
        this.initTimer();
        this.isActive = 1;
        msg.innerText = "Back in it 😤";
      }
    },

    play() {
      const loop = () => {
        if (!running || disposed) return;

        this.move("D");

        if (this.curComplete) {
          this.markBoardShape(this.curX, this.curY, this.curShape);
          for (const el of this.curSqs) this.sqs.push(el);
          this.calcScore({ shape: true });
          this.checkRows();
          this.checkScore();
          this.initShapes();
        }

        this.pTimer = setTimeout(loop, this.speed);
        this.isActive = 1;
      };
      this.pTimer = setTimeout(loop, this.speed);
    },

    incScore(amount) {
      this.score += amount;
      this.renderInfo();
    },

    incLevel() {
      this.level++;
      this.speed = Math.max(120, this.speed - 75);
      this.renderInfo();
    },

    incLines(num) {
      this.lines += num;
      this.renderInfo();
    },

    calcScore(args) {
      const lines = args.lines || 0;
      const shape = args.shape || false;
      let add = 0;

      if (lines > 0) {
        add += lines * this["level" + this.level][1];
        this.incLines(lines);
      }
      if (shape === true) {
        add += this["level" + this.level][2];
      }
      this.incScore(add);
    },

    checkScore() {
      if (this.level < this.numLevels && this.score >= this["level" + this.level][0]) this.incLevel();
    },

    getBoardIdx(x, y) {
      return x + y * this.boardWidth;
    },

    boardPos(x, y) {
      return this.board[x + y * this.boardWidth];
    },

    markBoardAt(x, y, val) {
      this.board[this.getBoardIdx(x, y)] = val;
    },

    markBoardShape(x, y, p) {
      for (let i = 0; i < p.length; i++) {
        const newX = p[i][0] + x;
        const newY = p[i][1] + y;
        this.markBoardAt(newX, newY, 1);
      }
    },

    isOB(x, y, p) {
      const w = this.boardWidth - 1;
      const h = this.boardHeight - 1;
      for (let i = 0; i < p.length; i++) {
        const newX = p[i][0] + x;
        const newY = p[i][1] + y;
        if (newX < 0 || newX > w || newY < 0 || newY > h) return true;
      }
      return false;
    },

    isCollision(x, y, p) {
      for (let i = 0; i < p.length; i++) {
        const newX = p[i][0] + x;
        const newY = p[i][1] + y;
        if (this.boardPos(newX, newY) === 1) return true;
      }
      return false;
    },

    checkMove(x, y, p) {
      return !(this.isOB(x, y, p) || this.isCollision(x, y, p));
    },

    move(dir) {
      let axis = "";
      let tempX = this.curX;
      let tempY = this.curY;

      switch (dir) {
        case "L": axis = "left"; tempX -= 1; break;
        case "R": axis = "left"; tempX += 1; break;
        case "D": axis = "top";  tempY += 1; break;
        case "RT": this.rotate(); return;
        default: return;
      }

      if (this.checkMove(tempX, tempY, this.curShape)) {
        for (const sq of this.curSqs) {
          const v = parseInt(sq.style[axis], 10);
          const next = (dir === "L") ? (v - this.pSize) : (v + this.pSize);
          sq.style[axis] = next + "px";
        }
        this.curX = tempX;
        this.curY = tempY;
      } else if (dir === "D") {
        // hit bottom
        if (this.curY === 1) {
          this.gameOver();
          return;
        }
        this.curComplete = true;
      }
    },

    rotate() {
      // no rotate for square
      if (this.curShapeIndex === 6) return;

      const temp = [];
      for (let i = 0; i < this.curShape.length; i++) {
        const pt = this.curShape[i];
        temp.push([pt[1] * -1, pt[0]]);
      }

      if (this.checkMove(this.curX, this.curY, temp)) {
        this.curShape = temp;
        this.removeCur();
        this.drawShape(this.curX, this.curY, this.curShape);
      }
    },

    getRowState(y) {
      let c = 0;
      for (let x = 0; x < this.boardWidth; x++) if (this.boardPos(x, y) === 1) c++;
      if (c === 0) return "E";
      if (c === this.boardWidth) return "F";
      return "U";
    },

    emptyBoardRow(y) {
      for (let x = 0; x < this.boardWidth; x++) this.markBoardAt(x, y, 0);
    },

    removeBlock(x, y) {
      this.markBoardAt(x, y, 0);
      for (let i = this.sqs.length - 1; i >= 0; i--) {
        const b = this.sqs[i];
        const bx = parseInt(b.style.left, 10) / this.pSize;
        const by = parseInt(b.style.top, 10) / this.pSize;
        if (bx === x && by === y) {
          if (b.parentNode === canvas) canvas.removeChild(b);
          this.sqs.splice(i, 1);
        }
      }
    },

    removeRow(y) {
      for (let x = 0; x < this.boardWidth; x++) this.removeBlock(x, y);
    },

    setBlock(x, y, block) {
      this.markBoardAt(x, y, 1);
      block.style.left = x * this.pSize + "px";
      block.style.top = y * this.pSize + "px";
    },

    shiftRow(y, amount) {
      for (let i = 0; i < this.sqs.length; i++) {
        const b = this.sqs[i];
        const bx = parseInt(b.style.left, 10) / this.pSize;
        const by = parseInt(b.style.top, 10) / this.pSize;
        if (by === y) this.setBlock(bx, y + amount, b);
      }
      this.emptyBoardRow(y);
    },

    checkRows() {
      let cleared = 0;

      for (let y = this.boardHeight - 1; y >= 0; y--) {
        const st = this.getRowState(y);
        if (st === "F") {
          this.removeRow(y);
          cleared++;
        } else if (st === "U" && cleared > 0) {
          this.shiftRow(y, cleared);
        } else if (st === "E" && cleared === 0) {
          // early exit if nothing above
        }
      }

      if (cleared > 0) {
        this.calcScore({ lines: cleared });
        msg.innerText = cleared >= 2 ? `Cleaned up ${cleared} lines 😳💗` : `Line cleared +${cleared}`;
      }
    },

    gameOver() {
      this.clearTimers();
      this.unbindKeyEvents();
      running = false;
      this.isActive = 0;

      this.finalScore = this.score;
      this.finalLines = this.lines;

      canvas.innerHTML = `
        <div style="
          position:absolute; inset:0;
          display:flex; align-items:center; justify-content:center;
          text-align:center; padding:14px;
          background:rgba(255,255,255,.75);
          font-weight:700;
          border-radius:16px;
        ">
          GAME OVER<br><span style="font-weight:600; font-size:12px;">Score ${this.score} • Lines ${this.lines}</span>
        </div>
      `;

      msg.innerText = "Minyoung: “Okay… that was stressful.” 😭";
      restartBtn.style.display = "inline-block";

      // Reward payout
      payoutRewards(this.finalScore, this.finalLines);
    }
  };

  // --- Rewards mapping ---
  function payoutRewards(score, lines) {
    // Tuned to feel rewarding but capped
    const heartsEarned = clamp(Math.floor(score / 140) + lines * 2, 8, 60);
    const affectionEarned = clamp(Math.floor(score / 380) + Math.floor(lines / 2) + 3, 4, 30);

    addRewards(heartsEarned, affectionEarned);

    // mood reactions
    if (score >= 1200 || lines >= 10) setMood("happy", { persist: true });
    else if (score <= 250 && Math.random() < 0.35) setMood(

/***********************
  Mini Game: Hangman
************************/
function gameHangman(root) {
  touchAction();
  $("gameTitle").innerText = "🧩 Hangman";

  root.innerHTML = "";
  const wrap = document.getElementById("hangmanWrap");
  if (!wrap) {
    root.innerHTML = `<div class="game-frame">Missing #hangmanWrap HTML. Paste the HTML block once into your page.</div>`;
    isMiniGameRunning = false;
    return;
  }
  wrap.classList.remove("hidden");
  root.appendChild(wrap);

  // Required elements (same IDs as your script)
  const wordElement = document.getElementById("word");
  const wrongLettersElement = document.getElementById("wrong-letters");
  const playAgainButton = document.getElementById("play-button");
  const popup = document.getElementById("popup-container");
  const notification = document.getElementById("notification-container");
  const finalMessage = document.getElementById("final-message");
  const finalMessageRevealWord = document.getElementById("final-message-reveal-word");
  const figureParts = document.querySelectorAll("#hangmanWrap .figure-part");

  const earnedHeartsEl = document.getElementById("hEarned");
  const earnedAffectionEl = document.getElementById("aEarned");
  const restartBtn = document.getElementById("hRestartBtn");

  // Reset UI
  popup.style.display = "none";
  notification.classList.remove("show");
  wrongLettersElement.innerHTML = "";
  earnedHeartsEl.innerText = "0";
  earnedAffectionEl.innerText = "0";
  figureParts.forEach((p) => (p.style.display = "none"));

  // Words (you can swap these anytime)
  const words = [
    "application",
    "programming",
    "interface",
    "wizard",
    "element",
    "prototype",
    "callback",
    "undefined",
    "arguments",
    "settings",
    "selector",
    "container",
    "instance",
    "response",
    "console",
    "constructor",
    "token",
    "function",
    "return",
    "length",
    "type",
    "node",
  ];

  let selectedWord = words[Math.floor(Math.random() * words.length)];
  let playable = true;
  const correctLetters = [];
  const wrongLetters = [];

  let disposed = false;
  let payoutDone = false;

  function showNotification() {
    notification.classList.add("show");
    setTimeout(() => {
      notification.classList.remove("show");
    }, 1200);
  }

  function displayWord() {
    wordElement.innerHTML = `
      ${selectedWord
        .split("")
        .map(
          (letter) => `
            <span class="h-letter">${correctLetters.includes(letter) ? letter : ""}</span>
          `
        )
        .join("")}
    `;

    const innerWord = wordElement.innerText.replace(/\n/g, "");
    if (innerWord === selectedWord) {
      finalMessage.innerText = "You won 💗";
      finalMessageRevealWord.innerText = "";
      popup.style.display = "block";
      playable = false;
      if (!payoutDone) payout(true);
    }
  }

  function updateWrongLettersElement() {
    wrongLettersElement.innerHTML = `
      ${wrongLetters.length > 0 ? "<p style='margin:0 0 6px 0; font-weight:700;'>Wrong</p>" : ""}
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${wrongLetters.map((letter) => `<span class="h-wrong">${letter}</span>`).join("")}
      </div>
    `;

    figureParts.forEach((part, index) => {
      const errors = wrongLetters.length;
      part.style.display = index < errors ? "block" : "none";
    });

    if (wrongLetters.length === figureParts.length) {
      finalMessage.innerText = "You lost 😭";
      finalMessageRevealWord.innerText = `The word was: ${selectedWord}`;
      popup.style.display = "block";
      playable = false;
      if (!payoutDone) payout(false);
    }
  }

  function payout(won) {
    payoutDone = true;

    const mistakes = wrongLetters.length; // 0..6
    const remaining = figureParts.length - mistakes;

    let hearts = 0;
    let affection = 0;

    if (won) {
      hearts = clamp(18 + remaining * 6, 18, 60);
      affection = clamp(10 + remaining * 3, 10, 35);
      setMood("happy", { persist: true });
    } else {
      hearts = clamp(8 + Math.max(0, remaining) * 2, 8, 22);
      affection = clamp(4 + Math.max(0, remaining), 4, 14);
      if (Math.random() < 0.35) setMood("sad", { persist: true });
    }

    addRewards(hearts, affection);
    earnedHeartsEl.innerText = String(hearts);
    earnedAffectionEl.innerText = String(affection);

    maybePopup("afterGame");
  }

  function resetGame(newWord) {
    playable = true;
    payoutDone = false;

    correctLetters.splice(0);
    wrongLetters.splice(0);

    selectedWord = newWord || words[Math.floor(Math.random() * words.length)];

    popup.style.display = "none";
    wrongLettersElement.innerHTML = "";
    earnedHeartsEl.innerText = "0";
    earnedAffectionEl.innerText = "0";

    figureParts.forEach((p) => (p.style.display = "none"));

    displayWord();
    updateWrongLettersElement();
  }

  // Key handler (saved so we can remove it on cleanup)
  function onKeyPress(e) {
    if (disposed) return;
    if (!playable) return;

    const letter = (e.key || "").toLowerCase();
    if (letter < "a" || letter > "z") return;

    if (selectedWord.includes(letter)) {
      if (!correctLetters.includes(letter)) {
        correctLetters.push(letter);
        displayWord();
      } else {
        showNotification();
      }
    } else {
      if (!wrongLetters.includes(letter)) {
        wrongLetters.push(letter);
        updateWrongLettersElement();
      } else {
        showNotification();
      }
    }
  }

  window.addEventListener("keypress", onKeyPress);

  // Buttons
  playAgainButton.onclick = () => {
    touchAction();
    resetGame();
  };

  restartBtn.onclick = () => {
    touchAction();
    resetGame();
  };

  // Init
  displayWord();
  updateWrongLettersElement();

  // Cleanup when switching games
  stopCurrentGame = () => {
    disposed = true;
    playable = false;
    window.removeEventListener("keypress", onKeyPress);
    wrap.classList.add("hidden");
    isMiniGameRunning = false;
  };
}



/***********************
  TRIAL 2: Dakgalbi (timing)
************************/
function trialDakgalbi(root) {
  $("gameTitle").innerText = "🍲 Trial: Make Perfect Dakgalbi";

  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Press <span class="kbd">Space</span> when the heat is PERFECT • 3 rounds</div>
        <div>Perfect: <strong id="dakPerfect">0</strong>/3</div>
      </div>

      <div style="margin-top:14px; padding:12px; border-radius:16px; background:rgba(255,255,255,.72); border:1px dashed rgba(255,77,136,.35);">
        <div class="small" style="white-space:pre-line;">
Heat meter moves back and forth.
Hit the sweet spot (the PINK zone).
No restart button if you fail.
        </div>
        <div style="height:18px; background:rgba(0,0,0,.08); border-radius:999px; overflow:hidden; margin-top:12px; position:relative;">
          <div id="dakSweet" style="position:absolute; left:42%; width:16%; top:0; bottom:0; background:rgba(255,77,136,.35);"></div>
          <div id="dakNeedle" style="position:absolute; width:10px; top:-6px; bottom:-6px; background:rgba(255,77,136,.95); border-radius:8px;"></div>
        </div>
        <div class="center small" style="margin-top:10px;" id="dakMsg"></div>
      </div>

      <div class="center" style="margin-top:12px;">
        <button class="btn ghost" id="dakLeave">Leave</button>
      </div>
    </div>
  `;

  const needle = $("dakNeedle");
  const msg = $("dakMsg");
  const perfectEl = $("dakPerfect");

  let running = true;
  let rounds = 0;
  let perfect = 0;

  // meter
  let x = 0.05;
  let dir = 1;
  let speed = 0.85;

  function inSweetSpot(v) {
    // sweet zone roughly 0.42..0.58
    return v >= 0.42 && v <= 0.58;
  }

  function updateUI() {
    needle.style.left = `${Math.round(x * 100)}%`;
    perfectEl.innerText = String(perfect);
  }

  function nextRoundText() {
    msg.innerText = `Round ${rounds + 1}/3… wait…`;
  }

  function tick() {
    if (!running) return;
    x += dir * speed * 0.012;
    if (x >= 0.95) { x = 0.95; dir = -1; }
    if (x <= 0.05) { x = 0.05; dir = 1; }
    updateUI();
    requestAnimationFrame(tick);
  }

  function press() {
    if (!running) return;
    touchAction();

    rounds++;
    const ok = inSweetSpot(x);

    if (ok) {
      perfect++;
      msg.innerText = "Perfect heat 🔥💗";
      setMood("happy", { persist: true });
    } else {
      msg.innerText = "Oops… too spicy / too cold 😭";
      if (Math.random() < 0.35) setMood("sad", { persist: true });
    }

    updateUI();

    if (rounds >= 3) {
      end();
    } else {
      // increase difficulty slightly
      speed += 0.18;
      setTimeout(() => {
        if (!running) return;
        nextRoundText();
      }, 650);
    }
  }

  function end() {
    running = false;

    // Pass rule: 2 or 3 perfect
    const passed = perfect >= 2;

    msg.innerText = passed
      ? "Dakgalbi is PERFECT. Minyoung is impressed 😳💗"
      : "Dakgalbi is… questionable. Try again later 🥺";

    // NO restart button. Only leave/back.
    const leave = $("dakLeave");
    leave.className = "btn";
    leave.innerText = passed ? "Continue" : "Back to Mini Games";
    leave.onclick = () => {
      touchAction();
      finishStageTrial(2, passed);
      showView("minigames");
    };

    stopCurrentGame = () => {
      running = false;
      isTrialRunning = false;
      isMiniGameRunning = false;
      window.removeEventListener("keydown", onKey);
    };
  }

  function onKey(e) {
    if (e.code === "Space") {
      e.preventDefault();
      press();
    }
  }

  $("dakLeave").addEventListener("click", () => {
    touchAction();
    // leaving counts as fail (no restart)
    finishStageTrial(2, false);
    showView("minigames");
  });

  window.addEventListener("keydown", onKey);
  nextRoundText();
  requestAnimationFrame(tick);
}

/***********************
  TRIAL 3: Pixel Space Pinball (with aliendog.png floating)
************************/
function trialPinball(root) {
  $("gameTitle").innerText = "🛸 Trial: Pixel Space Pinball";

  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Flip: <span class="kbd">Z</span>/<span class="kbd">/</span> • Score target: <strong>900</strong></div>
        <div>Score: <strong id="pbScore">0</strong></div>
      </div>
      <canvas class="canvas" id="pbCanvas" width="720" height="360"></canvas>
      <div class="center small" style="margin-top:10px;" id="pbMsg"></div>

      <div class="center" style="margin-top:10px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button class="btn ghost" id="pbLeave">Leave</button>
      </div>
    </div>
  `;

  const canvas = $("pbCanvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const msg = $("pbMsg");
  const scoreEl = $("pbScore");

  let running = true;
  let score = 0;
  const target = 900;

  // ball physics (simple)
  const ball = { x: 360, y: 80, vx: 120, vy: 0, r: 6 };

  // walls
  const bounds = { left: 40, right: 680, top: 20, bottom: 340 };

  // bumpers (stars)
  const bumpers = [
    { x: 220, y: 120, r: 16, pts: 90, emoji: "⭐" },
    { x: 500, y: 120, r: 16, pts: 90, emoji: "⭐" },
    { x: 360, y: 170, r: 18, pts: 120, emoji: "🌟" }
  ];

  // floating alien dog bumper
  const alienDog = {
    img: new Image(),
    x: 360,
    y: 250,
    r: 18,
    t: 0,
    pts: 160
  };
  alienDog.img.src = `assets/characters/aliendog.png?v=${SPRITE_VERSION}`;

  // paddles (simple rectangles)
  const leftPad = { x: 250, y: 310, w: 80, h: 10, up: false };
  const rightPad = { x: 390, y: 310, w: 80, h: 10, up: false };

  // combo: hit 3 bumpers within window
  let comboCount = 0;
  let comboUntil = 0;

  function addScore(n) {
    score += n;
    scoreEl.innerText = String(score);
  }

  function clampBall() {
    if (ball.x - ball.r < bounds.left) { ball.x = bounds.left + ball.r; ball.vx *= -1; }
    if (ball.x + ball.r > bounds.right) { ball.x = bounds.right - ball.r; ball.vx *= -1; }
    if (ball.y - ball.r < bounds.top) { ball.y = bounds.top + ball.r; ball.vy *= -1; }
    if (ball.y + ball.r > bounds.bottom) { ball.y = bounds.bottom - ball.r; ball.vy *= -0.7; } // soft bounce
  }

  function hitCircle(cx, cy, cr) {
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    return d <= (cr + ball.r);
  }

  function bounceFromCircle(cx, cy) {
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    const nx = dx / d;
    const ny = dy / d;

    // push ball out
    ball.x = cx + nx * (ball.r + 18);
    ball.y = cy + ny * (ball.r + 18);

    // reflect velocity
    const dot = ball.vx * nx + ball.vy * ny;
    ball.vx = ball.vx - 2 * dot * nx;
    ball.vy = ball.vy - 2 * dot * ny;

    // add a little juice
    ball.vx *= 1.02;
    ball.vy *= 1.02;
  }

  function hitRect(r) {
    return (
      ball.x + ball.r > r.x &&
      ball.x - ball.r < r.x + r.w &&
      ball.y + ball.r > r.y &&
      ball.y - ball.r < r.y + r.h
    );
  }

  function bounceFromPaddle(p) {
    // simple upward kick
    ball.y = p.y - ball.r - 1;
    ball.vy = -Math.abs(ball.vy) - (p.up ? 260 : 180);
    // sideways influence
    const center = p.x + p.w / 2;
    const dx = (ball.x - center) / (p.w / 2);
    ball.vx += dx * 120;
  }

  function drawBG() {
    // pixel starfield
    ctx.fillStyle = "rgba(20, 14, 36, 0.95)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // twinkles
    for (let i = 0; i < 70; i++) {
      const x = (i * 97) % canvas.width;
      const y = (i * 53) % canvas.height;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    // border
    ctx.strokeStyle = "rgba(255,77,136,.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  }

  function drawBumpers() {
    bumpers.forEach((b) => {
      ctx.font = "18px ui-monospace, system-ui";
      ctx.fillText(b.emoji, b.x - 8, b.y + 8);
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function drawAlienDog() {
    // float around a bit
    const w = 36;
    const h = 36;
    if (alienDog.img.complete && alienDog.img.naturalWidth > 0) {
      ctx.globalAlpha = 0.95;
      ctx.drawImage(alienDog.img, alienDog.x - w / 2, alienDog.y - h / 2, w, h);
      ctx.globalAlpha = 1;
    } else {
      ctx.font = "18px ui-monospace, system-ui";
      ctx.fillText("👽🐶", alienDog.x - 14, alienDog.y + 6);
    }
  }

  function drawPaddles() {
    ctx.fillStyle = "rgba(255,77,136,.9)";
    ctx.fillRect(leftPad.x, leftPad.y, leftPad.w, leftPad.h);
    ctx.fillRect(rightPad.x, rightPad.y, rightPad.w, rightPad.h);
  }

  function drawBall() {
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.fillRect(Math.round(ball.x - ball.r), Math.round(ball.y - ball.r), ball.r * 2, ball.r * 2);
  }

  let last = performance.now();
  function loop(now) {
    if (!running) return;
    const dt = (now - last) / 1000;
    last = now;

    // physics
    const gravity = 620;
    ball.vy += gravity * dt;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // float alien dog
    alienDog.t += dt;
    alienDog.x = 360 + Math.sin(alienDog.t * 1.3) * 120;
    alienDog.y = 250 + Math.cos(alienDog.t * 1.1) * 20;

    clampBall();

    // bumpers collisions
    for (const b of bumpers) {
      if (hitCircle(b.x, b.y, b.r)) {
        bounceFromCircle(b.x, b.y);
        addScore(b.pts);

        const nowMs = Date.now();
        if (nowMs > comboUntil) {
          comboCount = 0;
          comboUntil = nowMs + 2500;
        }
        comboCount += 1;
        if (comboCount >= 3) {
          addScore(250);
          comboCount = 0;
          comboUntil = 0;
          msg.innerText = "COMBO! ✨ +250";
        } else {
          msg.innerText = `Star hit! (+${b.pts})`;
        }
      }
    }

    // alien dog bumper
    if (hitCircle(alienDog.x, alienDog.y, alienDog.r)) {
      bounceFromCircle(alienDog.x, alienDog.y);
      addScore(alienDog.pts);
      msg.innerText = `Alien dog boost! (+${alienDog.pts}) 👽🐶`;
    }

    // paddles
    leftPad.up = keys.z;
    rightPad.up = keys.slash;

    // raise paddles slightly when pressed
    leftPad.y = leftPad.up ? 304 : 310;
    rightPad.y = rightPad.up ? 304 : 310;

    if (hitRect(leftPad) && ball.vy > 0) bounceFromPaddle(leftPad);
    if (hitRect(rightPad) && ball.vy > 0) bounceFromPaddle(rightPad);

    // if ball "drains" (falls below)
    if (ball.y > bounds.bottom + 20) {
      // fail condition (no restart button)
      end(false);
      return;
    }

    // win condition
    if (score >= target) {
      end(true);
      return;
    }

    drawBG();
    drawBumpers();
    drawAlienDog();
    drawPaddles();
    drawBall();

    requestAnimationFrame(loop);
  }

  const keys = { z: false, slash: false };

  function onKeyDown(e) {
    if (e.key === "z" || e.key === "Z") keys.z = true;
    if (e.key === "/") keys.slash = true;
  }
  function onKeyUp(e) {
    if (e.key === "z" || e.key === "Z") keys.z = false;
    if (e.key === "/") keys.slash = false;
  }

  function end(passed) {
    running = false;

    msg.innerText = passed
      ? "You cleared the pinball trial 💗"
      : "Ball drained… try again later 🥺";

    const leave = $("pbLeave");
    leave.className = "btn";
    leave.innerText = passed ? "Continue" : "Back to Mini Games";
    leave.onclick = () => {
      touchAction();
      finishStageTrial(3, passed);
      showView("minigames");
    };

    stopCurrentGame = () => {
      running = false;
      isTrialRunning = false;
      isMiniGameRunning = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }

  $("pbLeave").addEventListener("click", () => {
    touchAction();
    finishStageTrial(3, false);
    showView("minigames");
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  msg.innerText = "Hit bumpers, avoid draining. Target: 900";
  requestAnimationFrame(loop);
}

/***********************
  TRIAL 4: Minyoung Party (cute graphics, competitive mean)
  - Click GOOD items to earn points
  - Avoid BAD items (they subtract points + make her mad)
  - Survive timer + hit score threshold
************************/
function trialMinyoungParty(root) {
  $("gameTitle").innerText = "🌌 Trial: Destory Onions for Minyoung";

  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>
          Move: <span class="kbd">←</span>/<span class="kbd">→</span> or <span class="kbd">A</span>/<span class="kbd">D</span>
          • Shoot: <span class="kbd">Space</span> (hold)
          • 100 seconds
        </div>
        <div>Score: <strong id="gaScore">0</strong> / <strong>100</strong></div>
      </div>

      <canvas class="canvas" id="gaCanvas" width="720" height="360"></canvas>

      <div class="center small" style="margin-top:10px;" id="gaMsg">Onion fleet inbound. Don’t get hit.</div>

      <div class="center" style="margin-top:10px;">
        <button class="btn ghost" id="gaLeave">Leave</button>
      </div>
    </div>
  `;

  const canvas = $("gaCanvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const scoreEl = $("gaScore");
  const msg = $("gaMsg");
  const leaveBtn = $("gaLeave");

  let running = true;
  let score = 0;
  const PASS_SCORE = 1000;

  // timer
  let tLeft = 18000;
  let last = performance.now();

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }
  function addScore(n) {
    score += n;
    scoreEl.innerText = String(score);
  }

  /***********************
    SFX (tiny beeps)
    - Uses WebAudio, safe fallback if blocked
  ************************/
  let audioCtx = null;
  function sfx(freq = 520, dur = 0.04, type = "square", gain = 0.02) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch {}
  }
  const SFX = {
    shoot() { sfx(820, 0.03, "square", 0.015); },
    shootPowered() { sfx(960, 0.03, "sawtooth", 0.014); },
    enemyShoot() { sfx(280, 0.04, "triangle", 0.012); },
    kill() { sfx(620, 0.03, "square", 0.02); sfx(420, 0.05, "triangle", 0.012); },
    hit() { sfx(160, 0.08, "sawtooth", 0.02); }
  };

  // player
  const player = {
    x: canvas.width / 2,
    y: canvas.height - 34,
    w: 34,
    h: 18,
    speed: 460,
    vx: 0,
    hp: 3,
    invulnMs: 0
  };

  // power-up (alien dog)
  const alienDog = {
    img: new Image(),
    active: false,      // currently on screen (as a pickup)
    x: 360,
    y: -999,
    w: 34,
    h: 34,
    vy: 110,
    spawnCooldownMs: 2200, // first spawn delay
    powerModeMs: 0     // time remaining in power-up mode
  };
  alienDog.img.src = `assets/characters/aliendog.png?v=${SPRITE_VERSION}`;

  // projectiles
  const bullets = [];
  const enemyShots = [];

  // input
  const keys = { left: false, right: false, fire: false };

  // fire rate
  let fireCooldownMs = 0;

  // waves
  let wave = 0;
  let waveCooldownMs = 450;
  const enemies = [];

  // background stars
  const stars = Array.from({ length: 70 }, (_, i) => ({
    x: (i * 97) % canvas.width,
    y: (i * 53) % canvas.height,
    s: 1 + (i % 2),
    v: 12 + (i % 7)
  }));

  function spawnWave() {
    wave += 1;

    const cols = clamp(6 + Math.floor(wave / 2), 6, 10);
    const rows = clamp(2 + Math.floor(wave / 3), 2, 4);
    const spacingX = 52;
    const spacingY = 42;

    const startX = canvas.width / 2 - ((cols - 1) * spacingX) / 2;
    const startY = 30 + Math.min(40, wave * 4);

    const baseVy = 26 + wave * 4;
    const baseAmp = 24 + wave * 3;
    const baseFreq = 1.2 + wave * 0.07;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const shooter = Math.random() < (0.18 + wave * 0.02);
        enemies.push({
          x: startX + c * spacingX,
          y: startY + r * spacingY,
          r: 16,
          emoji: "🧅",
          hp: shooter ? 2 : 1,
          vy: baseVy + r * 4,
          amp: baseAmp + r * 6,
          freq: baseFreq + c * 0.05,
          phase: Math.random() * Math.PI * 2,
          shooter,
          shotCooldown: shooter ? (850 + Math.random() * 950) : 999999
        });
      }
    }

    msg.innerText = `Wave ${wave} 🚀`;
  }

  function shootPlayer() {
    if (!running) return;
    if (fireCooldownMs > 0) return;

    // power-up changes
    const powered = alienDog.powerModeMs > 0;
    fireCooldownMs = powered ? 75 : 120;

    const bulletVy = -760;
    const bulletR = powered ? 4 : 3;

    // basic shot
    bullets.push({ x: player.x, y: player.y - 16, vy: bulletVy, r: bulletR });

    // triple shot in power mode
    if (powered) {
      bullets.push({ x: player.x - 10, y: player.y - 14, vy: bulletVy, r: bulletR, vx: -120 });
      bullets.push({ x: player.x + 10, y: player.y - 14, vy: bulletVy, r: bulletR, vx: 120 });
      SFX.shootPowered();
    } else {
      SFX.shoot();
    }
  }

  function shootEnemy(e) {
    enemyShots.push({
      x: e.x,
      y: e.y + 12,
      vy: 270 + wave * 10,
      r: 3
    });
    SFX.enemyShoot();
  }

  function rectHitCircle(rx, ry, rw, rh, cx, cy, cr) {
    const x = clamp(cx, rx, rx + rw);
    const y = clamp(cy, ry, ry + rh);
    const dx = cx - x;
    const dy = cy - y;
    return dx * dx + dy * dy <= cr * cr;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function drawBackground(dt) {
    ctx.fillStyle = "rgba(10, 8, 22, 0.96)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#fff";
    for (const s of stars) {
      s.y += s.v * dt;
      if (s.y > canvas.height) s.y = -4;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // power-up glow hint
    if (alienDog.powerModeMs > 0) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "rgba(255,77,136,1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "rgba(255,77,136,1)";
    ctx.fillRect(0, canvas.height - 26, canvas.width, 2);
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    // invuln flicker
    if (player.invulnMs > 0 && Math.floor(player.invulnMs / 80) % 2 === 0) {
      ctx.globalAlpha = 0.35;
    }

    ctx.fillStyle = "rgba(255,77,136,.95)";
    ctx.beginPath();
    ctx.moveTo(player.x, player.y - 14);
    ctx.lineTo(player.x - 18, player.y + 10);
    ctx.lineTo(player.x + 18, player.y + 10);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = ctx.globalAlpha * 0.85;
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.fillRect(player.x - 4, player.y - 4, 8, 8);

    ctx.globalAlpha = 1;

    // HP
    ctx.font = "14px ui-monospace, system-ui";
    ctx.globalAlpha = 0.85;
    ctx.fillText("💗".repeat(player.hp), 10, canvas.height - 10);

    // power timer
    if (alienDog.powerModeMs > 0) {
      const sec = Math.ceil(alienDog.powerModeMs / 1000);
      ctx.fillText(`🐶 POWER ${sec}s`, 10, canvas.height - 28);
    }
    ctx.globalAlpha = 1;
  }

  function drawBullets() {
    // player bullets
    ctx.fillStyle = "rgba(255,255,255,.95)";
    for (const b of bullets) {
      ctx.fillRect(Math.round(b.x - 1), Math.round(b.y - 8), 2, 10);
    }

    // enemy shots
    ctx.fillStyle = "rgba(255,77,136,.95)";
    for (const s of enemyShots) {
      ctx.fillRect(Math.round(s.x - 1), Math.round(s.y - 2), 2, 8);
    }
  }

  function drawEnemies() {
    for (const e of enemies) {
      ctx.font = "24px ui-monospace, system-ui";
      ctx.globalAlpha = 0.95;
      ctx.fillText(e.emoji, e.x - 12, e.y + 10);

      if (e.shooter || e.hp > 1) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "rgba(255,255,255,.65)";
        ctx.beginPath();
        ctx.arc(e.x, e.y, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawAlienDogPickup() {
    if (!alienDog.active) return;

    const w = alienDog.w;
    const h = alienDog.h;
    if (alienDog.img.complete && alienDog.img.naturalWidth > 0) {
      ctx.globalAlpha = 0.98;
      ctx.drawImage(alienDog.img, alienDog.x - w / 2, alienDog.y - h / 2, w, h);
      ctx.globalAlpha = 1;
    } else {
      ctx.font = "22px ui-monospace, system-ui";
      ctx.fillText("👽🐶", alienDog.x - 14, alienDog.y + 8);
    }

    // subtle ring
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.beginPath();
    ctx.arc(alienDog.x, alienDog.y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function end(passed) {
    running = false;
    isTrialRunning = false;
    isMiniGameRunning = false;

    msg.innerText = passed
      ? "Fleet defeated. You absolutely annihilated the onions 😳💗"
      : "You got overwhelmed… try again later 🥺";

    leaveBtn.className = "btn";
    leaveBtn.innerText = passed ? "Continue" : "Back to Mini Games";
    leaveBtn.onclick = () => {
      touchAction();
      finishStageTrial(4, passed);
      showView("minigames");
    };

    cleanup();
    stopCurrentGame = () => {
      cleanup();
      isTrialRunning = false;
      isMiniGameRunning = false;
    };
  }

  function cleanup() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("pointerdown", onPointer);
    // don't close audioCtx; leaving it is fine and avoids glitches
  }

  function onKeyDown(e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;

    if (e.code === "Space") {
      e.preventDefault();
      keys.fire = true;
      // prime audio permission on first interaction
      try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
  }

  function onKeyUp(e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
    if (e.code === "Space") keys.fire = false;
  }

  function onPointer() {
    keys.fire = true;
    shootPlayer();
    setTimeout(() => (keys.fire = false), 120);
  }

  // Leave = fail
  leaveBtn.addEventListener("click", () => {
    touchAction();
    finishStageTrial(4, false);
    showView("minigames");
    cleanup();
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointerdown", onPointer);

  function maybeSpawnAlienDog(dtMs) {
    // cooldown counts down while NOT active and NOT in power mode
    if (alienDog.powerModeMs > 0) return;
    if (alienDog.active) return;

    alienDog.spawnCooldownMs -= dtMs;
    if (alienDog.spawnCooldownMs > 0) return;

    // spawn pickup
    alienDog.active = true;
    alienDog.x = 80 + Math.random() * (canvas.width - 160);
    alienDog.y = -20;
    alienDog.vy = 120 + Math.random() * 60;

    // next spawn after it’s collected/missed
    alienDog.spawnCooldownMs = 4200 + Math.random() * 2400;
  }

  function loop(now) {
    if (!running) return;
    const dt = (now - last) / 1000;
    const dtMs = dt * 1000;
    last = now;

    // countdown
    tLeft -= dtMs;
    if (tLeft <= 0) {
      end(score >= PASS_SCORE);
      return;
    }

    // power timer
    alienDog.powerModeMs = Math.max(0, alienDog.powerModeMs - dtMs);

    // waves
    waveCooldownMs -= dtMs;
    if (waveCooldownMs <= 0 && enemies.length < 10) {
      spawnWave();
      waveCooldownMs = 1300 + Math.max(0, 700 - wave * 80);
    }

    // player movement
    player.vx = 0;
    if (keys.left) player.vx = -player.speed;
    if (keys.right) player.vx = player.speed;

    player.x += player.vx * dt;
    player.x = clamp(player.x, 22, canvas.width - 22);

    // fire
    fireCooldownMs = Math.max(0, fireCooldownMs - dtMs);
    if (keys.fire) shootPlayer();

    // invuln
    player.invulnMs = Math.max(0, player.invulnMs - dtMs);

    // alien dog pickup spawn + movement
    maybeSpawnAlienDog(dtMs);
    if (alienDog.active) {
      alienDog.y += alienDog.vy * dt;

      const pRect = { x: player.x - player.w / 2, y: player.y - player.h / 2, w: player.w, h: player.h };
      const aRect = { x: alienDog.x - alienDog.w / 2, y: alienDog.y - alienDog.h / 2, w: alienDog.w, h: alienDog.h };

      if (rectsOverlap(pRect, aRect)) {
        alienDog.active = false;
        alienDog.powerModeMs = 4000;
        msg.innerText = "ALIEN DOG MODE 🐶💫";
        // little sparkle sound
        sfx(1040, 0.06, "triangle", 0.02);
        sfx(840, 0.07, "sine", 0.015);
        if (Math.random() < 0.35) setMood("happy", { persist: true });
      } else if (alienDog.y > canvas.height + 40) {
        alienDog.active = false;
      }
    }

    // bullets update (some powered bullets have slight vx)
    for (const b of bullets) {
      b.y += b.vy * dt;
      if (b.vx) b.x += b.vx * dt;
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      if (bullets[i].y < -30 || bullets[i].x < -40 || bullets[i].x > canvas.width + 40) bullets.splice(i, 1);
    }

    // enemy shots update
    for (const s of enemyShots) s.y += s.vy * dt;
    for (let i = enemyShots.length - 1; i >= 0; i--) {
      if (enemyShots[i].y > canvas.height + 30) enemyShots.splice(i, 1);
    }

    // enemies update (sine drift + descent)
    const t = performance.now() / 1000;
    for (const e of enemies) {
      e.y += e.vy * dt;
      e.x += Math.sin(t * e.freq + e.phase) * e.amp * dt;
      e.x = clamp(e.x, 16, canvas.width - 16);

      if (e.shooter) {
        e.shotCooldown -= dtMs;
        if (e.shotCooldown <= 0) {
          e.shotCooldown = 700 + Math.random() * 900;
          if (Math.random() < 0.55) shootEnemy(e);
        }
      }
    }

    // player hit by enemy shots
    if (player.invulnMs <= 0) {
      for (let i = enemyShots.length - 1; i >= 0; i--) {
        const s = enemyShots[i];
        const hit = rectHitCircle(
          player.x - player.w / 2,
          player.y - player.h / 2,
          player.w,
          player.h,
          s.x,
          s.y,
          6
        );
        if (hit) {
          enemyShots.splice(i, 1);
          player.hp -= 1;
          player.invulnMs = 800;
          msg.innerText = "Hit! 😭";
          SFX.hit();

          if (Math.random() < 0.5) setMood("angry", { persist: true });
          if (player.hp <= 0) {
            end(false);
            return;
          }
          break;
        }
      }
    }

    // enemies escaping bottom = penalty
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].y > canvas.height + 20) {
        enemies.splice(i, 1);
        addScore(-12);
        msg.innerText = "An onion escaped 😭  (-12)";
        if (Math.random() < 0.35) setMood("sad", { persist: true });
      }
    }

    // bullets vs enemies
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      const e = enemies[ei];
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const b = bullets[bi];
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        if (dx * dx + dy * dy <= (e.r + 6) * (e.r + 6)) {
          bullets.splice(bi, 1);
          e.hp -= 1;

          if (e.hp <= 0) {
            enemies.splice(ei, 1);

            // points (power mode gives small bonus too)
            const powered = alienDog.powerModeMs > 0;
            const basePts = e.shooter ? 14 : 10;
            const pts = powered ? basePts + 2 : basePts;

            addScore(pts);
            msg.innerText = `Blasted! +${pts}`;
            SFX.kill();

            if (Math.random() < 0.18) setMood("happy", { persist: true });
          } else {
            msg.innerText = "Hit! (finish it)";
          }
          break;
        }
      }
    }

    // draw
    drawBackground(dt);
    drawBullets();
    drawEnemies();
    drawAlienDogPickup();
    drawPlayer();

    // pass hint
    if (score >= PASS_SCORE) {
      msg.innerText = alienDog.powerModeMs > 0
        ? "Score ≥ 100. POWER MODE, SURVIVE 🐶💫"
        : "Score ≥ 100. Survive 😳";
    }

    requestAnimationFrame(loop);
  }

  stopCurrentGame = () => {
    running = false;
    isTrialRunning = false;
    isMiniGameRunning = false;
    cleanup();
  };

  msg.innerText = "Onion fleet inbound. Lock in 😤";
  requestAnimationFrame(loop);
}


/***********************
  INIT
************************/
load();
state.stage = clampStage(state.stage || 1);
enforceCheats();
recomputeStage();
renderHUD();
showView("home");
speak("Nate… your mission is simple: make Minyoung laugh, feed her, and impress her with gifts 💗");
startIdleWatcher();

// Dev cheat hotkey: Ctrl+Shift+L
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === "L" || e.key === "l")) {
    e.preventDefault();
    // only when safe (no games/trials/ending)
    openCheatMenu();
  }
});

// sometimes a popup greets you
setTimeout(() => {
  if (Math.random() < 0.25) maybePopup("home");
}, 700);


















