import './style.css'

type Rarity = 'N' | 'R' | 'SR'

type State = {
  holding: boolean
  holdMs: number
  pityFails: number // 0..6
  lastResult?: { win: boolean; rarity?: Rarity }
}

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

function openItemModal(r: Rarity, item: Item, header?: string) {
  itemEmojiEl.textContent = item.emoji
  itemNameEl.textContent = header ? `${header} ${item.name}` : item.name
  itemRarityEl.textContent = r === 'SR' ? '激アツ' : r === 'R' ? 'レア' : 'ノーマル'
  itemRarityEl.dataset.r = r
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

function doRoll(progress01: number) {
  // pity: 6 failures -> guaranteed win with special item
  if (state.pityFails >= 6) {
    state.pityFails = 0
    setResult('確定演出！', 'pity')
    vibrate([30, 40, 20])
    const item = { name: '確定券', emoji: '🎟️' }
    openItemModal('SR', item, '確定！')
    return { win: true, rarity: 'SR' as Rarity, pity: true }
  }

  const win = Math.random() < WIN_RATE
  if (win) {
    state.pityFails = 0
    const r = rarityFromProgress(progress01)
    setResult(r === 'SR' ? '大当たり！！' : r === 'R' ? '当たり！' : '当たり', 'ok')
    vibrate([20, 30, 10])
    const pool = ITEM_POOL[r]
    const item = pool[Math.floor(Math.random() * pool.length)]
    openItemModal(r, item)
    return { win: true, rarity: r, pity: false }
  }

  state.pityFails = Math.min(6, state.pityFails + 1)
  setResult('ハズレ…', 'ng')
  vibrate(12)
  return { win: false as const, pity: false }
}

// --- Input: hold-to-charge ---
let lastT = performance.now()
let hitstopMs = 0
let shake = 0

function startHold() {
  state.holding = true
  holdBtn.classList.add('is-holding')
  setResult('…', 'idle')
  vibrate(8)
}

function endHold() {
  if (!state.holding) return
  state.holding = false
  holdBtn.classList.remove('is-holding')

  const p = clamp01(state.holdMs / HOLD_FULL_MS)
  const result = doRoll(p)

  // impact package
  const cx = w * 0.5
  const cy = h * 0.45
  if (result.win) {
    hitstopMs = result.pity ? 90 : 55
    shake = result.pity ? 18 : 10
    burst(cx, cy, result.pity ? 1 : p, result.pity ? 48 : result.rarity === 'SR' ? 52 : result.rarity === 'R' ? 200 : 32)
  } else {
    hitstopMs = 35
    shake = 7
    burst(cx, cy, 0.35, 210)
  }

  state.holdMs = 0
}

holdBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  holdBtn.setPointerCapture(e.pointerId)
  startHold()
})

holdBtn.addEventListener('pointerup', () => endHold())
holdBtn.addEventListener('pointercancel', () => endHold())
holdBtn.addEventListener('pointerleave', () => {
  // allow slide-out without cancelling; keep holding
})

// --- Render loop ---
function drawBG(t: number, progress01: number) {
  // subtle animated gradient
  const g = ctx.createLinearGradient(0, 0, w, h)
  const base = 220 + Math.sin(t * 0.0005) * 10
  const pulse = easeOutCubic(progress01)
  g.addColorStop(0, `hsl(${base - 30}, 60%, ${10 + pulse * 10}%)`)
  g.addColorStop(1, `hsl(${base + 40}, 70%, ${8 + pulse * 12}%)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // vignette
  const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.7)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, h)
}

function drawOrb(t: number, progress01: number) {
  const p = easeOutCubic(progress01)
  const cx = w * 0.5
  const cy = h * 0.45

  // anticipation squash while holding
  const sq = state.holding ? 1 - 0.04 * Math.sin(t * 0.02) : 1

  // glow
  const glowR = 58 + p * 90
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR)
  rg.addColorStop(0, `hsla(${200 - p * 160}, 90%, 65%, ${0.25 + p * 0.25})`)
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = rg
  ctx.beginPath()
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
  ctx.fill()

  // core orb
  const orbR = 42 + p * 18
  const og = ctx.createRadialGradient(cx - 12, cy - 14, 0, cx, cy, orbR)
  og.addColorStop(0, `hsl(${190 - p * 120}, 90%, 72%)`)
  og.addColorStop(1, `hsl(${230 + p * 40}, 70%, 35%)`)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(1 + p * 0.06, sq - p * 0.02)
  ctx.translate(-cx, -cy)
  ctx.fillStyle = og
  ctx.beginPath()
  ctx.arc(cx, cy, orbR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // orbiting sparks while holding
  if (state.holding) {
    const rings = 12
    for (let i = 0; i < rings; i++) {
      const a = t * 0.004 + (i / rings) * Math.PI * 2
      const rr = orbR + 14 + p * 28
      const x = cx + Math.cos(a) * rr
      const y = cy + Math.sin(a) * rr * 0.55
      ctx.fillStyle = `hsla(${200 - p * 140}, 90%, 70%, ${0.25 + p * 0.35})`
      ctx.beginPath()
      ctx.arc(x, y, 2.2 + p * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
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
    ctx.fillStyle = `hsla(${p.hue}, 95%, 70%, ${0.65 * a})`
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r * (0.6 + a), 0, Math.PI * 2)
    ctx.fill()
  }
}

function frame(now: number) {
  const dt = now - lastT
  lastT = now

  if (hitstopMs > 0) {
    hitstopMs -= dt
    // during hitstop: still render but don't advance hold meter too much
  }

  if (state.holding) {
    // nonlinear fill: slow then fast
    const speed = 1 + Math.pow(state.holdMs / HOLD_FULL_MS, 1.6) * 2.2
    state.holdMs = Math.min(HOLD_FULL_MS, state.holdMs + dt * speed)
  }

  const p01 = clamp01(state.holdMs / HOLD_FULL_MS)
  updateHud(p01)

  // shake
  const s = shake
  if (shake > 0) shake = Math.max(0, shake - dt * 0.06)
  const ox = (Math.random() - 0.5) * s
  const oy = (Math.random() - 0.5) * s

  ctx.save()
  ctx.translate(ox, oy)
  drawBG(now, p01)
  drawOrb(now, p01)
  drawParticles(dt)
  ctx.restore()

  requestAnimationFrame(frame)
}

setResult('押して…', 'idle')
updateHud(0)
requestAnimationFrame(frame)
