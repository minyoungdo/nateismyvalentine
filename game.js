/* game.js (FULL) */
/***********************
  Minyoung Maker (Stages 1–4)
  - 5 mini games: catch, pop, memory, react, dino
  - Mood system: neutral/happy/sad/angry
  - Random popup questions that affect mood (not obvious)
  - Shop hides affection effects
  - Any gift makes Minyoung happy sprite immediately
  - Auto stage evolve (no button)
  - Idle 30s without shopping or games => angry
  - Dino Run upgrades: boing SFX, heart trail, stage-themed obstacles
************************/

const $ = (id) => document.getElementById(id);

const VIEWS = {
  home: $("view-home"),
  minigames: $("view-minigames"),
  shop: $("view-shop"),
  game: $("view-game")
};

const SAVE_KEY = "minyoungMakerSave_v3";

const state = {
  hearts: 0,
  affection: 0,
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

  lastActionAt: Date.now()
};

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
  if (state.mood === "angry") setMood("neutral", { persist: true });
  save();
}

function spritePathFor(stage, mood) {
  const s = clampStage(stage);
  const m = ["happy", "sad", "angry", "neutral"].includes(mood) ? mood : "neutral";
  return `assets/characters/stage${s}-${m}.png`;
}

function updateSprite() {
  const img = $("character");
  if (!img) return;

  const desired = spritePathFor(state.stage, state.mood);
  img.onerror = () => {
    // fallback: neutral sprite for that stage
    img.onerror = () => {
      img.removeAttribute("src");
      img.alt = "Missing sprite. Add assets/characters/stage1-neutral.png etc.";
    };
    img.src = spritePathFor(state.stage, "neutral");
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

function recomputeStage() {
  // Simple auto-evolve thresholds (edit if you want)
  // Stage 1: <150, Stage 2: 150-499, Stage 3: 500-999, Stage 4: 1000+
  const a = state.affection || 0;
  let newStage = 1;
  if (a >= 150) newStage = 2;
  if (a >= 500) newStage = 3;
  if (a >= 1000) newStage = 4;

  newStage = clampStage(newStage);
  if (newStage !== state.stage) {
    state.stage = newStage;
    // stage change goes neutral (sprite updates automatically)
    state.mood = "neutral";
  }

  updateSprite();
  save();
  renderHUD();
}

function addRewards(heartsEarned, affectionEarned) {
  state.hearts += heartsEarned;

  const boosted = Math.round(affectionEarned * (state.affectionMult || 1));
  state.affection += boosted;

  save();
  recomputeStage();
  renderHUD();
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
  // cooldown to reduce spam
  if (state.popupCooldown > 0) {
    state.popupCooldown -= 1;
    save();
    return;
  }

  let chance = context === "afterGame" ? 0.55 : context === "afterGift" ? 0.35 : 0.25;

  // Tornado Fudge slightly increases popup chance
  if (state.buffTornadoFudge > 0 && Math.random() < 0.25) chance += 0.12;

  if (Math.random() > chance) return;

  const pick = POPUPS[Math.floor(Math.random() * POPUPS.length)];
  openPopup(pick);

  state.popupCooldown = 2;

  // tick down timed buffs whenever a popup happens
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

      // ---- Buff logic: gently bend outcomes (not obvious) ----
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
    desc: `Chewy, savory, impossible to stop eating. Restores energy after long workdays.`

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

  /* New items you requested */
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

  // hidden affection value
  const hidden = item.affectionHidden ?? 0;
  const boosted = Math.round(hidden * (state.affectionMult || 1));
  state.affection += boosted;

  state.inventory.push(item.name);
  if (typeof item.onBuy === "function") item.onBuy();

  // Any gift => happy immediately
  setMood("happy", { persist: true });
  speak("Minyoung received a gift… and her mood instantly improved 💗");

  save();
  recomputeStage();
  renderHUD();
  renderShop();

  maybePopup("afterGift");
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
      if (Math.random() < 0.25) maybePopup("home");
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
  showView("minigames");
});

document.querySelectorAll("[data-game]").forEach((btn) => {
  btn.addEventListener("click", () => startGame(btn.getAttribute("data-game")));
});

function startGame(key) {
  touchAction();
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
    const heartsEarned = clamp(score * 2, 5, 40);
    const affectionEarned = Math.max(2, Math.round(score * 1.2));
    addRewards(heartsEarned, affectionEarned);

    $("catchMsg").innerText = `Result: +${heartsEarned} hearts 💗`;
    speak("Minyoung: “Okay wait… that was kind of awesome.”");

    if (score >= 10) setMood("happy", { persist: true });
    else if (score <= 2 && Math.random() < 0.35) setMood("sad", { persist: true });

    // Goofy Nate: extra line sometimes
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

  stopCurrentGame = () => {};
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
    clearTimeout(timeoutId);
  };

  nextRound();
}

/* Game 5: Minyoung Dino Run (boing + heart trail + themed obstacles) */
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

  // boing SFX using WebAudio
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
  sprite.src = `assets/characters/stage${clampStage(state.stage)}-neutral.png`;

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
    cleanup();
  };

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







