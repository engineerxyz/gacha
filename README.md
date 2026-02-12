# ガチャ (Gacha)

Mobile-friendly hold-to-charge gacha mini-game (2D canvas) designed for **GitHub Pages**.

- Hold button to charge → release to roll
- Win rate: **16%**
- Fail counter stacks up to **6**
- On 6 fails: special **確定演出** reward (item payout)

## Dev

```bash
npm i
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Notes

This project uses Vite.
For GitHub Pages path routing, `vite.config.ts` sets:

- `base: '/gacha/'`
