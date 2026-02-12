import './style.css'

type Rarity = 'N' | 'R' | 'SR'

type State = {
  holding: boolean
  holdMs: number
  pityFails: number // 0..6
}

type Outcome =
  | { win: true; rarity: Rarity; pity: boolean; item: Item; header?: string }
  | { win: false; pity: boolean; item: Item; header?: string }

type Phase = 'idle' | 'charging' | 'reveal1' | 'reveal2' | 'reveal3'

const WIN_RATE = 0.16
const HOLD_FULL_MS = 1400

const state: State = {
  holding: false,
  holdMs: 0,
  pityFails: 0,
}

// --- UI ---
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
<div class="screen">
  <canvas id="c"></canvas>

  <div class="hud">
    <div class="title">ガチャ</div>
    <div class="sub">押しつづけて…</div>

    <div class="meter">
      <div class="meter__bar" id="bar"></div>
      <div class="meter__ticks">
        <span>ノーマル</span><span>レア</span><span>激アツ</span>
      </div>
    </div>

    <div class="row">
      <div class="pill">失敗: <b id="fails">0</b>/6</div>
      <div class="pill" id="pity">確定: なし</div>
    </div>

    <button class="hold" id="hold" type="button" aria-label="hold">
      <span class="hold__label">押す</span>
      <span class="hold__hint">(長押し)</span>
    </button>

    <div class="result" id="result"></div>
  </div>

  <div class="modal" id="modal" role="dialog" aria-modal="true">
    <div class="card">
      <div class="card__emoji" id="itemEmoji">🥣</div>
      <div class="card__name" id="itemName">…</div>
      <div class="card__rarity" id="itemRarity" data-r="N">ノーマル</div>
      <button class="btn" id="close" type="button">OK</button>
    </div>
  </div>
</div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#c')!
const bar = document.querySelector<HTMLDivElement>('#bar')!
const failsEl = document.querySelector<HTMLSpanElement>('#fails')!
const pityEl = document.querySelector<HTMLDivElement>('#pity')!
const resultEl = document.querySelector<HTMLDivElement>('#result')!
const holdBtn = document.querySelector<HTMLButtonElement>('#hold')!

const modal = document.querySelector<HTMLDivElement>('#modal')!
const itemEmojiEl = document.querySelector<HTMLDivElement>('#itemEmoji')!
const itemNameEl = document.querySelector<HTMLDivElement>('#itemName')!
const itemRarityEl = document.querySelector<HTMLDivElement>('#itemRarity')!
const closeBtn = document.querySelector<HTMLButtonElement>('#close')!

// --- Canvas ---
const ctx = canvas.getContext('2d', { alpha: false })!
let w = 0,
  h = 0,
  dpr = 1

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  w = Math.floor(window.innerWidth)
  h = Math.floor(window.innerHeight)
  canvas.width = Math.floor(w * dpr)
  canvas.height = Math.floor(h * dpr)
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
window.addEventListener('resize', resize)
resize()

// --- Juicy helpers ---
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function vibrate(pattern: number | number[]) {
  // best-effort
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav: any = navigator
  if (nav?.vibrate) nav.vibrate(pattern)
}

function setResult(text: string, tone: 'ok' | 'ng' | 'pity' | 'idle') {
  resultEl.textContent = text
  resultEl.dataset.tone = tone
}

function updateHud(progress01: number) {
  bar.style.width = `${Math.floor(progress01 * 100)}%`
  failsEl.textContent = String(state.pityFails)
  pityEl.textContent = state.pityFails >= 6 ? '確定: あり' : '確定: なし'
}

// --- Items (cute cereal / food) ---
type Item = { name: string; emoji: string }
const ITEM_POOL: Record<Rarity, Item[]> = {
  N: [
    { name: 'コーンフレーク', emoji: '🌽' },
    { name: 'ミルク', emoji: '🥛' },
    { name: 'いちご', emoji: '🍓' },
    { name: 'バナナ', emoji: '🍌' },
    { name: 'はちみつ', emoji: '🍯' },
  ],
  R: [
    { name: 'プロテインシリアル', emoji: '🥣' },
    { name: 'チョコグラノーラ', emoji: '🍫' },
    { name: 'ナッツミックス', emoji: '🥜' },
  ],
  SR: [
    { name: 'キラキラ限定シリアル', emoji: '✨🥣' },
    { name: '伝説のチョコボウル', emoji: '👑🍫' },
  ],
}

function openItemModal(r: Rarity | 'NG', item: Item, header?: string) {
  itemEmojiEl.textContent = item.emoji
  itemNameEl.textContent = header ? `${header} ${item.name}` : item.name
  itemRarityEl.textContent = r === 'SR' ? '激アツ' : r === 'R' ? 'レア' : r === 'N' ? 'ノーマル' : '…'
  itemRarityEl.dataset.r = r === 'NG' ? 'N' : r
  modal.classList.add('is-open')
}

function closeModal() {
  modal.classList.remove('is-open')
}

closeBtn.addEventListener('click', closeModal)
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal()
})

// --- Particles ---
type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number; r: number }
const ps: P[] = []
function burst(x: number, y: number, power: number, hue: number) {
  const n = Math.floor(18 + power * 26)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = (1 + Math.random() * 2.2) * (2 + power * 6)
    ps.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (2 + power * 3),
      life: 0,
      max: 450 + Math.random() * 350,
      hue,
      r: 1.2 + Math.random() * (1.5 + power * 1.8),
    })
  }
}

// --- Game logic ---
function rarityFromProgress(p: number): Rarity {
  if (p > 0.92) return 'SR'
  if (p > 0.66) return 'R'
  return 'N'
}

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function computeOutcome(progress01: number): Outcome {
  // 6 failures -> special payout
  if (state.pityFails >= 6) {
    state.pityFails = 0
    return {
      win: true,
      rarity: 'SR',
      pity: true,
      item: { name: '確定券', emoji: '🎟️' },
      header: '確定！',
    }
  }

  const win = Math.random() < WIN_RATE
  if (win) {
    state.pityFails = 0
    const r = rarityFromProgress(progress01)
    return {
      win: true,
      rarity: r,
      pity: false,
      item: pick(ITEM_POOL[r]),
    }
  }

  state.pityFails = Math.min(6, state.pityFails + 1)
  return {
    win: false,
    pity: false,
    item: { name: '空っぽボウル', emoji: '🥣' },
    header: 'ハズレ…',
  }
}

// --- Input: hold-to-charge + cinematic reveal ---
let lastT = performance.now()
let hitstopMs = 0
let shake = 0
let phase: Phase = 'idle'
let phaseMs = 0
let pending: Outcome | null = null
let revealProgress = 0 // 0..1

function startHold() {
  state.holding = true
  phase = 'charging'
  holdBtn.classList.add('is-holding')
  setResult('…', 'idle')
  vibrate(8)
}

function endHold() {
  if (!state.holding) return
  state.holding = false
  holdBtn.classList.remove('is-holding')

  const p = clamp01(state.holdMs / HOLD_FULL_MS)
  pending = computeOutcome(p)

  // start 3-step cinematic
  phase = 'reveal1'
  phaseMs = 0
  revealProgress = 0

  state.holdMs = 0
}

holdBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  holdBtn.setPointerCapture(e.pointerId)
  startHold()
})

holdBtn.addEventListener('pointerup', () => endHold())
holdBtn.addEventListener('pointercancel', () => endHold())

// --- Render loop ---
function drawBG(t: number, charge01: number) {
  // pastel animated gradient
  const g = ctx.createLinearGradient(0, 0, w, h)
  const wobble = Math.sin(t * 0.0005) * 6
  const pulse = easeOutCubic(charge01)
  g.addColorStop(0, `hsl(${340 + wobble}, 90%, ${92 - pulse * 6}%)`)
  g.addColorStop(1, `hsl(${210 + wobble}, 90%, ${92 - pulse * 6}%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // vignette
  const vg = ctx.createRadialGradient(w * 0.5, h * 0.55, Math.min(w, h) * 0.15, w * 0.5, h * 0.55, Math.max(w, h) * 0.75)
  vg.addColorStop(0, 'rgba(255,255,255,0)')
  vg.addColorStop(1, 'rgba(43,42,51,0.18)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)
}

function drawOrb(t: number, charge01: number) {
  const p = easeOutCubic(charge01)
  const cx = w * 0.5
  const cy = h * 0.45

  // when revealing, focus-in
  const focus = phase.startsWith('reveal') ? easeInOut(revealProgress) : 0

  // anticipation squash while holding
  const sq = state.holding ? 1 - 0.04 * Math.sin(t * 0.02) : 1

  const glowR = 62 + p * 85 + focus * 50
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
  rg.addColorStop(0, `hsla(${200 - p * 120}, 95%, 70%, ${0.16 + p * 0.24 + focus * 0.12})`)
  rg.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = rg
  ctx.beginPath()
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
  ctx.fill()

  const orbR = 40 + p * 18 + focus * 10
  const og = ctx.createRadialGradient(cx - 12, cy - 14, 0, cx, cy, orbR)
  og.addColorStop(0, `hsl(${190 - p * 90}, 95%, 78%)`)
  og.addColorStop(1, `hsl(${240 + p * 20}, 70%, 50%)`)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1 + p * 0.06 + focus * 0.06, sq - p * 0.02)
  ctx.translate(-cx, -cy)
  ctx.fillStyle = og
  ctx.beginPath()
  ctx.arc(cx, cy, orbR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // orbiting sparks while holding or revealing
  const orbit = state.holding || phase === 'reveal1' || phase === 'reveal2'
  if (orbit) {
    const rings = 10
    for (let i = 0; i < rings; i++) {
      const a = t * 0.004 + (i / rings) * Math.PI * 2
      const rr = orbR + 14 + p * 26 + focus * 18
      const x = cx + Math.cos(a) * rr
      const y = cy + Math.sin(a) * rr * 0.55
      ctx.fillStyle = `hsla(${200 - p * 120}, 95%, 75%, ${0.22 + p * 0.28})`
      ctx.beginPath()
      ctx.arc(x, y, 2.1 + p * 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawRevealOverlay() {
  if (!phase.startsWith('reveal')) return
  // curtain / flash vibe
  const t = easeInOut(revealProgress)

  if (phase === 'reveal2') {
    const a = 0.22 + (1 - Math.abs(t * 2 - 1)) * 0.22
    ctx.fillStyle = `rgba(255,255,255,${a})`
    ctx.fillRect(0, 0, w, h)
  }

  // sparkly confetti band
  const bandY = h * 0.45
  ctx.fillStyle = `rgba(255,125,187,${0.08 * t})`
  ctx.fillRect(0, bandY - 80, w, 160)
}

function drawParticles(dt: number) {
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i]
    p.life += dt
    const t = p.life / p.max
    if (t >= 1) {
      ps.splice(i, 1)
      continue
    }
    p.vy += 0.012 * dt
    p.x += p.vx
    p.y += p.vy
    const a = 1 - t
    ctx.fillStyle = `hsla(${p.hue}, 95%, 70%, ${0.55 * a})`
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r * (0.6 + a), 0, Math.PI * 2)
    ctx.fill()
  }
}

function resolveReveal() {
  if (!pending) return
  if (pending.win) {
    setResult(pending.pity ? '確定演出！' : pending.rarity === 'SR' ? '大当たり！！' : pending.rarity === 'R' ? '当たり！' : '当たり', pending.pity ? 'pity' : 'ok')
    vibrate(pending.pity ? [25, 40, 20] : [20, 25, 10])
    const cx = w * 0.5
    const cy = h * 0.45
    hitstopMs = pending.pity ? 90 : 55
    shake = pending.pity ? 18 : 10
    burst(cx, cy, pending.pity ? 1 : 0.8, pending.pity ? 48 : pending.rarity === 'SR' ? 330 : pending.rarity === 'R' ? 250 : 200)
    openItemModal(pending.rarity, pending.item, pending.header)
  } else {
    setResult('ハズレ…', 'ng')
    vibrate(10)
    const cx = w * 0.5
    const cy = h * 0.45
    hitstopMs = 35
    shake = 7
    burst(cx, cy, 0.35, 210)
    // show something even on fail
    openItemModal('NG', pending.item, pending.header)
  }
  pending = null
}

function frame(now: number) {
  const dt = now - lastT
  lastT = now

  if (hitstopMs > 0) {
    hitstopMs -= dt
  }

  // charge logic
  if (state.holding) {
    const speed = 1 + Math.pow(state.holdMs / HOLD_FULL_MS, 1.6) * 2.2
    state.holdMs = Math.min(HOLD_FULL_MS, state.holdMs + dt * speed)
  }

  // reveal state machine
  if (phase.startsWith('reveal')) {
    phaseMs += dt
    if (phase === 'reveal1') {
      revealProgress = clamp01(phaseMs / 280)
      if (phaseMs >= 280) {
        phase = 'reveal2'
        phaseMs = 0
        revealProgress = 0
        vibrate(8)
      }
    } else if (phase === 'reveal2') {
      revealProgress = clamp01(phaseMs / 360)
      if (phaseMs >= 360) {
        phase = 'reveal3'
        phaseMs = 0
        revealProgress = 0
      }
    } else if (phase === 'reveal3') {
      revealProgress = clamp01(phaseMs / 260)
      if (phaseMs >= 120) {
        // resolve near start of phase3
        resolveReveal()
      }
      if (phaseMs >= 260) {
        phase = 'idle'
        phaseMs = 0
        revealProgress = 0
      }
    }
  }

  const charge01 = clamp01(state.holdMs / HOLD_FULL_MS)
  updateHud(charge01)

  // shake
  const s = shake
  if (shake > 0) shake = Math.max(0, shake - dt * 0.06)
  const ox = (Math.random() - 0.5) * s
  const oy = (Math.random() - 0.5) * s

  ctx.save()
  ctx.translate(ox, oy)
  drawBG(now, charge01)
  drawOrb(now, charge01)
  drawRevealOverlay()
  drawParticles(dt)
  ctx.restore()

  requestAnimationFrame(frame)
}

setResult('押して…', 'idle')
updateHud(0)
requestAnimationFrame(frame)
