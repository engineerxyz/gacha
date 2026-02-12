import { describe, it, expect } from 'vitest'
import { computeOutcome, rarityFromProgress, WIN_RATE } from '../src/logic'

// deterministic RNG helper
function rngSeq(values: number[]) {
  let i = 0
  return () => {
    const v = values[Math.min(i, values.length - 1)]
    i++
    return v
  }
}

describe('rarityFromProgress', () => {
  it('maps thresholds', () => {
    expect(rarityFromProgress(0)).toBe('N')
    expect(rarityFromProgress(0.7)).toBe('R')
    expect(rarityFromProgress(0.95)).toBe('SR')
  })
})

describe('computeOutcome', () => {
  it('increments pityFails on loss up to 6', () => {
    const s = { pityFails: 0 }
    const rng = rngSeq([0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99])
    for (let k = 0; k < 6; k++) computeOutcome(s, 0.2, rng, WIN_RATE)
    expect(s.pityFails).toBe(6)
  })

  it('resets pityFails on win', () => {
    const s = { pityFails: 3 }
    const rng = rngSeq([0.0])
    const out = computeOutcome(s, 0.8, rng, WIN_RATE)
    expect(out.win).toBe(true)
    expect(s.pityFails).toBe(0)
  })

  it('pity triggers when pityFails>=6 and gives SR pity item', () => {
    const s = { pityFails: 6 }
    const rng = rngSeq([0.99])
    const out = computeOutcome(s, 0.1, rng, WIN_RATE)
    expect(out.win).toBe(true)
    expect(out.pity).toBe(true)
    expect(out.rarity).toBe('SR')
    expect(out.item.name).toContain('確定')
    expect(s.pityFails).toBe(0)
  })

  it('loss returns fail bowl item', () => {
    const s = { pityFails: 0 }
    const rng = rngSeq([0.99])
    const out = computeOutcome(s, 0.2, rng, WIN_RATE)
    expect(out.win).toBe(false)
    expect(out.item.name).toContain('空っぽ')
    expect(s.pityFails).toBe(1)
  })
})
