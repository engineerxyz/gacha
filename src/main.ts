import './style.css'
import { startPhaserGame } from './phaserGame'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `<div id="game"></div>`

const game = startPhaserGame(document.querySelector<HTMLDivElement>('#game')!)
// debug hook
;(window as any).__gacha_game = game
