import './style.css'
import { startPhaserGame } from './phaserGame'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `<div id="game"></div>`

startPhaserGame(document.querySelector<HTMLDivElement>('#game')!)
