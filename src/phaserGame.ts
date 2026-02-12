import Phaser from 'phaser'

type Rarity = 'N' | 'R' | 'SR'

type Item = { name: string; emoji: string }

type Outcome =
  | { win: true; rarity: Rarity; pity: boolean; item: Item; header?: string }
  | { win: false; pity: boolean; item: Item; header?: string }

const WIN_RATE = 0.16
const HOLD_FULL_MS = 1400

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

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function rarityFromProgress(p: number): Rarity {
  if (p > 0.92) return 'SR'
  if (p > 0.66) return 'R'
  return 'N'
}

function makeRoundedRectTexture(scene: Phaser.Scene, key: string, w: number, h: number, r: number, fill: number, alpha = 1, stroke?: { color: number; width: number; alpha?: number }) {
  if (scene.textures.exists(key)) return
  const g = scene.make.graphics({ x: 0, y: 0 })
  g.clear()
  if (stroke) {
    g.lineStyle(stroke.width, stroke.color, stroke.alpha ?? 1)
  }
  g.fillStyle(fill, alpha)
  g.fillRoundedRect(0, 0, w, h, r)
  if (stroke) g.strokeRoundedRect(0, 0, w, h, r)
  g.generateTexture(key, w, h)
  g.destroy()
}

class MainScene extends Phaser.Scene {
  private holding = false
  private holdMs = 0
  private pityFails = 0
  private phase: 'idle' | 'charging' | 'reveal1' | 'reveal2' | 'reveal3' = 'idle'
  private phaseMs = 0
  private pending: Outcome | null = null

  private bg!: Phaser.GameObjects.Rectangle
  private orb!: Phaser.GameObjects.Arc
  private glow!: Phaser.GameObjects.Arc
  private sparkParticles!: Phaser.GameObjects.Particles.ParticleEmitter

  private meterFill!: Phaser.GameObjects.Image
  private meterW = 360
  private failsText!: Phaser.GameObjects.Text
  private pityText!: Phaser.GameObjects.Text
  private resultText!: Phaser.GameObjects.Text

  private holdBtn!: Phaser.GameObjects.Container

  private modal!: Phaser.GameObjects.Container
  private modalEmoji!: Phaser.GameObjects.Text
  private modalName!: Phaser.GameObjects.Text
  private modalRarity!: Phaser.GameObjects.Text

  constructor() {
    super('main')
  }

  create() {
    const { width: W, height: H } = this.scale

    // textures for UI
    makeRoundedRectTexture(this, 'pill', 180, 34, 17, 0xffffff, 0.78, { color: 0x2b2a33, width: 1, alpha: 0.08 })
    makeRoundedRectTexture(this, 'meterBg', Math.min(W * 0.92, 420), 18, 9, 0xffffff, 0.55, { color: 0x2b2a33, width: 1, alpha: 0.08 })
    makeRoundedRectTexture(this, 'meterFill', Math.min(W * 0.92, 420), 18, 9, 0xff7dbb, 0.95)
    makeRoundedRectTexture(this, 'btn', Math.min(W * 0.74, 280), 78, 26, 0xff7dbb, 1, { color: 0x2b2a33, width: 1, alpha: 0.08 })
    makeRoundedRectTexture(this, 'card', Math.min(W * 0.92, 420), 260, 26, 0xffffff, 0.92, { color: 0x2b2a33, width: 1, alpha: 0.10 })
    makeRoundedRectTexture(this, 'ok', Math.min(W * 0.92, 420) - 36, 46, 16, 0x7dd6ff, 1, { color: 0x2b2a33, width: 1, alpha: 0.08 })

    // background
    this.bg = this.add.rectangle(0, 0, W, H, 0xfff1f7).setOrigin(0)

    // orb + glow
    this.glow = this.add.circle(W / 2, H * 0.40, 120, 0xffa8d0, 0.22)
    this.orb = this.add.circle(W / 2, H * 0.40, 54, 0x7dd6ff, 1)

    // particles
    const particles = this.add.particles(0, 0, '__DEFAULT', {
      speed: { min: 80, max: 240 },
      lifespan: { min: 350, max: 700 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.9, end: 0 },
      gravityY: 240,
      blendMode: 'ADD',
      tint: [0xff7dbb, 0x7dd6ff, 0x8b7dff],
      emitting: false,
    })
    this.sparkParticles = particles

    // title
    this.add
      .text(W / 2, 26, 'ガチャ', {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: '30px',
        color: '#2b2a33',
        fontStyle: '900',
      })
      .setOrigin(0.5, 0)

    this.add
      .text(W / 2, 64, '押しつづけて…', {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: '13px',
        color: 'rgba(43,42,51,.65)',
      })
      .setOrigin(0.5, 0)

    // meter
    const meterW = Math.min(W * 0.92, 420)
    this.meterW = meterW
    this.add.image(W / 2, 110, 'meterBg').setOrigin(0.5)
    this.meterFill = this.add.image(W / 2 - meterW / 2, 110, 'meterFill').setOrigin(0, 0.5)
    this.meterFill.setCrop(0, 0, 0, 18)

    // fails/pity
    this.failsText = this.add.text(W / 2, 150, '失敗: 0/6', { fontFamily: 'system-ui', fontSize: '13px', color: '#2b2a33' }).setOrigin(0.5)
    this.pityText = this.add.text(W / 2, 172, '確定: なし', { fontFamily: 'system-ui', fontSize: '13px', color: 'rgba(43,42,51,.65)' }).setOrigin(0.5)

    // hold button
    const btnW = Math.min(W * 0.74, 280)
    const btn = this.add.image(0, 0, 'btn')
    const btnLabel = this.add.text(0, -8, '押す', { fontFamily: 'system-ui', fontSize: '20px', color: '#ffffff', fontStyle: '900' }).setOrigin(0.5)
    const btnHint = this.add.text(0, 18, '(長押し)', { fontFamily: 'system-ui', fontSize: '12px', color: 'rgba(255,255,255,.85)' }).setOrigin(0.5)
    this.holdBtn = this.add.container(W / 2, H * 0.78, [btn, btnLabel, btnHint])
    this.holdBtn.setSize(btnW, 78)
    this.holdBtn.setInteractive(new Phaser.Geom.Rectangle(-btnW / 2, -39, btnW, 78), Phaser.Geom.Rectangle.Contains)

    this.holdBtn.on('pointerdown', () => this.startHold())
    this.input.on('pointerup', () => this.endHold())

    // result
    this.resultText = this.add.text(W / 2, H * 0.78 + 64, '押して…', { fontFamily: 'system-ui', fontSize: '16px', color: '#2b2a33', fontStyle: '900' }).setOrigin(0.5)

    // modal
    const modalBg = this.add.rectangle(0, 0, W, H, 0x2b2a33, 0.18).setOrigin(0)
    const card = this.add.image(W / 2, H / 2, 'card')
    this.modalEmoji = this.add.text(W / 2, H / 2 - 70, '🥣', { fontFamily: 'system-ui', fontSize: '56px', color: '#2b2a33' }).setOrigin(0.5)
    this.modalName = this.add.text(W / 2, H / 2 - 10, '…', { fontFamily: 'system-ui', fontSize: '18px', color: '#2b2a33', fontStyle: '900' }).setOrigin(0.5)
    this.modalRarity = this.add.text(W / 2, H / 2 + 30, 'ノーマル', { fontFamily: 'system-ui', fontSize: '14px', color: 'rgba(43,42,51,.75)', fontStyle: '900' }).setOrigin(0.5)
    const ok = this.add.image(W / 2, H / 2 + 96, 'ok')
    const okText = this.add.text(W / 2, H / 2 + 96, 'OK', { fontFamily: 'system-ui', fontSize: '16px', color: '#2b2a33', fontStyle: '900' }).setOrigin(0.5)

    this.modal = this.add.container(0, 0, [modalBg, card, this.modalEmoji, this.modalName, this.modalRarity, ok, okText])
    this.modal.setVisible(false)

    modalBg.setInteractive()
    ok.setInteractive(new Phaser.Geom.Rectangle(ok.x - ok.width / 2, ok.y - ok.height / 2, ok.width, ok.height), Phaser.Geom.Rectangle.Contains)
    modalBg.on('pointerdown', () => this.closeModal())
    ok.on('pointerdown', () => this.closeModal())

    this.updateHud()

    // handle resize
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      const { width, height } = gameSize
      this.bg.setSize(width, height)
      modalBg.setSize(width, height)
      this.cameras.main.setViewport(0, 0, width, height)
    })
  }

  private updateHud() {
    const p = Phaser.Math.Clamp(this.holdMs / HOLD_FULL_MS, 0, 1)
    this.meterFill.setCrop(0, 0, Math.floor(this.meterW * p), 18)
    this.failsText.setText(`失敗: ${this.pityFails}/6`)
    this.pityText.setText(this.pityFails >= 6 ? '確定: あり' : '確定: なし')
  }

  private startHold() {
    if (this.modal.visible) return
    this.holding = true
    this.phase = 'charging'
    this.resultText.setText('…')
    this.tweens.killTweensOf(this.holdBtn)
    this.tweens.add({ targets: this.holdBtn, scale: 1.03, yoyo: true, repeat: -1, duration: 280, ease: 'Sine.easeInOut' })
  }

  private endHold() {
    if (!this.holding) return
    this.holding = false
    this.tweens.killTweensOf(this.holdBtn)
    this.holdBtn.setScale(1)

    const p = Phaser.Math.Clamp(this.holdMs / HOLD_FULL_MS, 0, 1)
    this.pending = this.computeOutcome(p)

    this.phase = 'reveal1'
    this.phaseMs = 0
    this.holdMs = 0
    this.updateHud()
  }

  private computeOutcome(progress01: number): Outcome {
    if (this.pityFails >= 6) {
      this.pityFails = 0
      return { win: true, rarity: 'SR', pity: true, item: { name: '確定券', emoji: '🎟️' }, header: '確定！' }
    }
    const win = Math.random() < WIN_RATE
    if (win) {
      this.pityFails = 0
      const r = rarityFromProgress(progress01)
      return { win: true, rarity: r, pity: false, item: pick(ITEM_POOL[r]) }
    }
    this.pityFails = Math.min(6, this.pityFails + 1)
    return { win: false, pity: false, item: { name: '空っぽボウル', emoji: '🥣' }, header: 'ハズレ…' }
  }

  private resolveReveal() {
    if (!this.pending) return
    const cx = this.scale.width / 2
    const cy = this.scale.height * 0.40

    if (this.pending.win) {
      const r = this.pending.rarity
      this.resultText.setText(this.pending.pity ? '確定演出！' : r === 'SR' ? '大当たり！！' : r === 'R' ? '当たり！' : '当たり')
      this.sparkParticles.explode(60 + (this.pending.pity ? 40 : 0), cx, cy)
      this.cameras.main.shake(this.pending.pity ? 180 : 120, this.pending.pity ? 0.008 : 0.005)
      this.openModal(r, this.pending.item, this.pending.header)
    } else {
      this.resultText.setText('ハズレ…')
      this.sparkParticles.explode(30, cx, cy)
      this.cameras.main.shake(100, 0.004)
      this.openModal('N', this.pending.item, this.pending.header)
    }

    this.pending = null
  }

  private openModal(r: Rarity, item: Item, header?: string) {
    this.modalEmoji.setText(item.emoji)
    this.modalName.setText(header ? `${header} ${item.name}` : item.name)
    this.modalRarity.setText(r === 'SR' ? '激アツ' : r === 'R' ? 'レア' : 'ノーマル')

    this.modal.setVisible(true)
    this.modal.setAlpha(0)
    this.tweens.add({ targets: this.modal, alpha: 1, duration: 140, ease: 'Sine.easeOut' })
  }

  private closeModal() {
    this.modal.setVisible(false)
  }

  update(_time: number, delta: number) {
    if (this.holding) {
      const p = Phaser.Math.Clamp(this.holdMs / HOLD_FULL_MS, 0, 1)
      const speed = 1 + Math.pow(p, 1.6) * 2.2
      this.holdMs = Math.min(HOLD_FULL_MS, this.holdMs + delta * speed)
      this.updateHud()

      const t = Phaser.Math.Clamp(this.holdMs / HOLD_FULL_MS, 0, 1)
      this.glow.setAlpha(0.18 + t * 0.22)
      this.glow.setRadius(120 + t * 80)
    }

    if (this.phase.startsWith('reveal')) {
      this.phaseMs += delta
      if (this.phase === 'reveal1') {
        const tt = Phaser.Math.Clamp(this.phaseMs / 280, 0, 1)
        this.orb.setScale(1 + 0.04 * tt)
        if (this.phaseMs >= 280) {
          this.phase = 'reveal2'
          this.phaseMs = 0
        }
      } else if (this.phase === 'reveal2') {
        const tt = Phaser.Math.Clamp(this.phaseMs / 360, 0, 1)
        const a = 0.05 + (1 - Math.abs(tt * 2 - 1)) * 0.18
        this.bg.setFillStyle(0xffffff)
        this.bg.setAlpha(a)
        if (this.phaseMs >= 360) {
          this.bg.setAlpha(1)
          this.bg.setFillStyle(0xfff1f7)
          this.phase = 'reveal3'
          this.phaseMs = 0
          this.resolveReveal()
        }
      } else if (this.phase === 'reveal3') {
        const tt = Phaser.Math.Clamp(this.phaseMs / 260, 0, 1)
        this.orb.setScale(1 + 0.02 * (1 - tt))
        if (this.phaseMs >= 260) {
          this.phase = 'idle'
          this.phaseMs = 0
        }
      }
    }
  }
}

export function startPhaserGame(parent: HTMLElement) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: '100%',
    height: '100%',
    backgroundColor: '#fff1f7',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [MainScene],
  })
}
