/* game.js (FULL) */
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
    - Final ending triggers at affection >= 1111, also with entry popup
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
  Stage gating + trials + ending
************************/
function desiredStageFromAffection(a) {
  let s = 1;
  if (a >= 150) s = 2;
  if (a >= 500) s = 3;
  if (a >= 1000) s = 4;
  return clampStage(s);
}

function recomputeStage() {
  const a = state.affection || 0;
  const desired = desiredStageFromAffection(a);

  // Gate progression: must pass each stage trial to unlock that stage.
  let unlocked = 1;

  if (desired >= 2 && state.stageTrialPassed?.[2]) unlocked = 2;
  if (desired >= 3 && state.stageTrialPassed?.[2] && state.stageTrialPassed?.[3]) unlocked = 3;
  if (desired >= 4 && state.stageTrialPassed?.[2] && state.stageTrialPassed?.[3] && state.stageTrialPassed?.[4]) unlocked = 4;

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

  // Ending trigger at 1111 affection
  maybeStartEnding();
}

function addRewards(heartsEarned, affectionEarned) {
  state.hearts += heartsEarned;
  const boosted = Math.round(affectionEarned * (state.affectionMult || 1));
  state.affection += boosted;

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
    4: "🌟 Stage 4 Trial: Star Beat Confession"
  };

  const descMap = {
    2: "Time the heat perfectly. Pass to unlock Stage 2 evolution.",
    3: "Score points in pixel pinball. Pass to unlock Stage 3 evolution.",
    4: "Hit the beats. Pass to unlock Stage 4 evolution."
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
    `Affection reached 1111.\n\n` +
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
  if ((state.affection || 0) < 1111) return false;

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
  if (stageNum === 4) return trialStarBeat(area);

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
        <div class="small" style="margin-bottom:8px;"><strong>Memory Wall (all stages)</strong></div>
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:8px;">
          <img style="width:100%; border-radius:12px;" src="${spritePathFor(1, "neutral")}" alt="stage1">
          <img style="width:100%; border-radius:12px;" src="${spritePathFor(2, "neutral")}" alt="stage2">
          <img style="width:100%; border-radius:12px;" src="${spritePathFor(3, "neutral")}" alt="stage3">
          <img style="width:100%; border-radius:12px;" src="${spritePathFor(4, "neutral")}" alt="stage4">
          <img style="width:100%; border-radius:12px;" src="${spritePathFor(Math.max(1, state.stage), "happy")}" alt="happy">
          <img style="width:100%; border-radius:12px;" src="${spritePathFor(Math.max(1, state.stage), "sad")}" alt="sad">
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
        "You loved her accurately.\n\n" +
        "Minyoung: “Okay… stop. I’m gonna cry.” 💗";
      mood = "happy";
    } else if (endingKey === "chaos") {
      endingText =
        "ENDING: Chaos Cute\n\n" +
        "You made love feel light.\n" +
        "Not shallow. Just… breathable.\n\n" +
        "Minyoung: “Why are you like this… I’m obsessed.” 💘";
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
        label: "“We’re building a life that feels safe.”",
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
                    "You move like you already know what she needs.\nShe watches you like she’s memorizing your hands.\n\nMinyoung: “That’s… unfair.”",
                    [
                      {
                        label: "Make a silly joke to cut the tension.",
                        chaos: 2,
                        onPick: () => {
                          setScene(
                            "She laughs. Quietly at first. Then fully.\n\nMinyoung: “Okay. Fine. You win.”",
                            [
                              { label: "Hold her hand.", soft: 1, devotion: 2, onPick: finishEnding },
                              { label: "Say “I’m in love with you” very plainly.", devotion: 3, onPick: finishEnding }
                            ]
                          );
                        }
                      },
                      {
                        label: "Write a short, honest card.",
                        devotion: 3,
                        onPick: () => {
                          setScene(
                            "She reads it twice.\nOnce with her eyes.\nOnce with her whole chest.\n\nMinyoung: “Stop…”",
                            [
                              { label: "Kiss her forehead.", soft: 2, devotion: 1, onPick: finishEnding },
                              { label: "Offer her your hoodie, like it’s a ring.", chaos: 1, soft: 1, onPick: finishEnding }
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
                    "Time slows.\nShe leans into you like it’s the most natural thing.\n\nMinyoung: “This is enough.”",
                    [
                      { label: "Stay. Don’t perform.", soft: 3, onPick: finishEnding },
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
                label: "Make her laugh so hard she forgets she’s worried.",
                chaos: 3,
                onPick: () => {
                  setScene(
                    "She tries to stay serious.\nShe fails.\n\nMinyoung: “I hate you.” (affectionate)",
                    [
                      { label: "Offer snacks like a peace treaty.", chaos: 1, soft: 2, onPick: finishEnding },
                      { label: "Do a dramatic bow: “My lady.”", chaos: 3, onPick: finishEnding }
                    ]
                  );
                }
              },
              {
                label: "Tell her one specific thing you love about her.",
                devotion: 3,
                onPick: () => {
                  setScene(
                    "Her eyes go soft.\n\nMinyoung: “Okay… don’t say it like that.”",
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
  $("hearts").innerText = state.hearts;
  $("affection").innerText = state.affection;
  $("stage").innerText = state.stage;
  $("mood").innerText = state.mood;

  $("stageLabel").innerText = STAGE_LABELS[state.stage] || `Stage ${state.stage}`;

  const passives = [];
  if (state.flags.perfume) passives.push("Perfume passive: +10% affection gains");
  if (state.flags.tennisBall) passives.push("Tennis Ball passive: some bad moments become funny memories");
  if (state.flags.safeSleepy) passives.push("Forehead Blanket: Safe & Sleepy unlocked");
  if (state.flags.tornadoFudge) passives.push("Tornado Fudge: chaos memories boosted");
  if (state.flags.goofyNate) passives.push("Goofy Nate: happy outcomes boosted");
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
    affectionHidden: 25,
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
    affectionHidden: 18,
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
    cost: 24,
    affectionHidden: 18,
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
    cost: 18,
    affectionHidden: 12,
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
    cost: 14,
    affectionHidden: 10,
    type: "Cozy",
    desc: `No phones. No scrolling. Just leaning into each other.`,
    flavor: `"Nothing happened. And it was perfect."`,
    unique: false
  },
  {
    id: "sawThis",
    name: `📦 “Saw This and Thought of You”`,
    cost: 20,
    affectionHidden: 15,
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
    cost: 22,
    affectionHidden: 18,
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
    cost: 26,
    affectionHidden: 20,
    type: "Trust",
    desc: `The final cookie. Untouched. Protected from himself.`,
    flavor: `"I was tempted. Be proud."`,
    unique: false
  },
  {
    id: "photo",
    name: `📸 “You Look Cute, Don’t Move” Photo`,
    cost: 20,
    affectionHidden: 17,
    type: "Memory",
    desc: `You insist you look chaotic. She insists you look perfect.`,
    flavor: `"I want to remember this version of you."`,
    unique: false
  },
  {
    id: "foreheadKiss",
    name: `💤 Forehead Kiss`,
    cost: 20,
    affectionHidden: 50,
    type: "Security",
    desc: `Gentle. Unrushed. Usually when you least expect it.`,
    flavor: `"Right here is my favorite place."`,
    unique: false
  },
  {
    id: "foreheadBlanket",
    name: `🌙 Forehead Blanket`,
    cost: 100,
    affectionHidden: 150,
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
    affectionHidden: 20,
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
    affectionHidden: 50,
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

  if (state.hearts < item.cost) {
    speak("Not enough hearts 😭 Go play mini games and come back.");
    return;
  }

  state.hearts -= item.cost;

  const hidden = item.affectionHidden ?? 0;
  const boosted = Math.round(hidden * (state.affectionMult || 1));
  state.affection += boosted;

  state.inventory.push(item.name);
  if (typeof item.onBuy === "function") item.onBuy();

  setMood("happy", { persist: true });
  speak("Minyoung received a gift… and her mood instantly improved 💗");

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

  if (key === "catch") return gameCatch(area);
  if (key === "pop") return gamePop(area);
  if (key === "memory") return gameMemory(area);
  if (key === "react") return gameReact(area);
  if (key === "dino") return gameDino(area);
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
        <div>Jump with <span class="kbd">Space</span> or <span class="kbd">↑</span> • tap/click canvas • 30 seconds</div>
        <div>Score: <strong id="dinoScore">0</strong></div>
      </div>
      <canvas class="canvas" id="dinoCanvas" width="720" height="360"></canvas>
      <div class="center small" style="margin-top:10px;" id="dinoMsg"></div>
    </div>
  `;

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
  let tLeft = 30000;

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

  function end(winLike = true) {
    running = false;
    isMiniGameRunning = false;
    cleanup();

    const heartsEarned = clamp(Math.round(score / 12) + 10, 10, 60);
    const affectionEarned = clamp(Math.round(score / 25) + 6, 6, 28);
    addRewards(heartsEarned, affectionEarned);

    $("dinoMsg").innerText = `Result: +${heartsEarned} hearts 💗`;

    if (winLike) {
      speak("Minyoung: “Okay wait… I’m kind of athletic?”");
      if (score >= 240) setMood("happy", { persist: true });
    } else {
      speak("Minyoung: “I tripped… but I did it cutely.”");
      if (Math.random() < 0.45) setMood("sad", { persist: true });
    }

    if (state.buffGoofyNate > 0 && Math.random() < 0.45) {
      speak("Minyoung: “I’m smiling. Don’t talk.”");
    }

    maybePopup("afterGame");
  }

  function loop(now) {
    if (!running) return;
    const dt = (now - last) / 1000;
    last = now;

    tLeft -= dt * 1000;
    if (tLeft <= 0) {
      end(true);
      return;
    }

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
        end(false);
        return;
      }
    }

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
    cleanup();
  };

  requestAnimationFrame(loop);
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
  alienDog.img.src = `aliendog.png?v=${SPRITE_VERSION}`;

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
  TRIAL 4: Star Beat (rhythm-ish)
************************/
function trialStarBeat(root) {
  $("gameTitle").innerText = "🌟 Trial: Star Beat Confession";

  root.innerHTML = `
    <div class="game-frame">
      <div class="row">
        <div>Press <span class="kbd">Space</span> when the star is in the zone • 12 beats</div>
        <div>Hits: <strong id="sbHits">0</strong>/12</div>
      </div>

      <canvas class="canvas" id="sbCanvas" width="720" height="360"></canvas>
      <div class="center small" style="margin-top:10px;" id="sbMsg"></div>

      <div class="center" style="margin-top:10px;">
        <button class="btn ghost" id="sbLeave">Leave</button>
      </div>
    </div>
  `;

  const canvas = $("sbCanvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const hitsEl = $("sbHits");
  const msg = $("sbMsg");

  let running = true;
  let total = 12;
  let beat = 0;
  let hits = 0;

  // falling star
  const star = { x: 360, y: 40, vy: 0, active: false };
  const zone = { y: 280, h: 30 };

  function spawnBeat() {
    star.y = 30;
    star.vy = 140 + Math.random() * 80;
    star.active = true;
    msg.innerText = `Beat ${beat + 1}/${total}…`;
  }

  function draw() {
    ctx.fillStyle = "rgba(18, 10, 30, 0.95)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // stars
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 90; i++) {
      const x = (i * 83) % canvas.width;
      const y = (i * 41) % canvas.height;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    // zone
    ctx.fillStyle = "rgba(255,77,136,.22)";
    ctx.fillRect(0, zone.y, canvas.width, zone.h);

    ctx.strokeStyle = "rgba(255,77,136,.55)";
    ctx.strokeRect(0, zone.y, canvas.width, zone.h);

    // star
    if (star.active) {
      ctx.font = "26px ui-monospace, system-ui";
      ctx.fillText("⭐", star.x - 12, star.y + 10);
    }
  }

  let last = performance.now();

  function loop(now) {
    if (!running) return;
    const dt = (now - last) / 1000;
    last = now;

    if (!star.active) {
      spawnBeat();
    } else {
      star.y += star.vy * dt;
      if (star.y > canvas.height + 40) {
        // missed
        star.active = false;
        beat++;
        if (beat >= total) return end();
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  function press() {
    if (!running) return;
    if (!star.active) return;
    touchAction();

    const inZone = star.y >= zone.y && star.y <= zone.y + zone.h;
    if (inZone) {
      hits++;
      hitsEl.innerText = String(hits);
      msg.innerText = "Perfect 💗";
      setMood("happy", { persist: true });
    } else {
      msg.innerText = "Off-beat 😭";
      if (Math.random() < 0.25) setMood("sad", { persist: true });
    }

    star.active = false;
    beat++;
    if (beat >= total) end();
  }

  function end() {
    running = false;

    const passed = hits >= 7; // 7/12 threshold
    msg.innerText = passed
      ? "You confessed perfectly under the stars 💘"
      : "The timing was… shy. Try again later 🥺";

    const leave = $("sbLeave");
    leave.className = "btn";
    leave.innerText = passed ? "Continue" : "Back to Mini Games";
    leave.onclick = () => {
      touchAction();
      finishStageTrial(4, passed);
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

  $("sbLeave").addEventListener("click", () => {
    touchAction();
    finishStageTrial(4, false);
    showView("minigames");
  });

  window.addEventListener("keydown", onKey);

  msg.innerText = "Get ready…";
  requestAnimationFrame(loop);
}

/***********************
  INIT
************************/
load();
state.stage = clampStage(state.stage || 1);
recomputeStage();
renderHUD();
showView("home");
speak("Nate… your mission is simple: make Minyoung laugh, feed her, and impress her with gifts 💗");
startIdleWatcher();

// sometimes a popup greets you
setTimeout(() => {
  if (Math.random() < 0.25) maybePopup("home");
}, 700);
