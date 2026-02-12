export type Rarity = 'N' | 'R' | 'SR'

export type Item = { name: string; emoji: string }

export type Outcome =
  | { win: true; rarity: Rarity; pity: boolean; item: Item; header?: string }
  | { win: false; pity: boolean; item: Item; header?: string }

export type State = {
  pityFails: number // 0..6
}

export const WIN_RATE = 0.16

export const ITEM_POOL: Record<Rarity, Item[]> = {
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

export function clamp01(x: number) {
  return Math.max(0, Math.min(1, x))
}

export function rarityFromProgress(p01: number): Rarity {
  const p = clamp01(p01)
  if (p > 0.92) return 'SR'
  if (p > 0.66) return 'R'
  return 'N'
}

export function pick<T>(arr: T[], rng = Math.random): T {
  return arr[Math.floor(rng() * arr.length)]
}

/**
 * Pure gacha outcome function.
 * Mutates state.pityFails (intentional), so tests can assert transitions.
 */
export function computeOutcome(
  state: State,
  progress01: number,
  rng = Math.random,
  winRate = WIN_RATE,
): Outcome {
  // pity: 6 failures -> special payout item
  if (state.pityFails >= 6) {
    state.pityFails = 0
    return { win: true, rarity: 'SR', pity: true, item: { name: '確定券', emoji: '🎟️' }, header: '確定！' }
  }

  const win = rng() < winRate
  if (win) {
    state.pityFails = 0
    const r = rarityFromProgress(progress01)
    return { win: true, rarity: r, pity: false, item: pick(ITEM_POOL[r], rng) }
  }

  state.pityFails = Math.min(6, state.pityFails + 1)
  return { win: false, pity: false, item: { name: '空っぽボウル', emoji: '🥣' }, header: 'ハズレ…' }
}
