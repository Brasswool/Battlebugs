# CHITIN

*A turn-based war of the small.* Two insect colonies, eight species, one hive to break — or a colony to erase.

**Stage 3 of 6 — point-buy armies, manual deployment, selectable win conditions, and human-vs-human hot seat.** No build step, no dependencies.

## Run it

**Option A (VS Code):** right-click `index.html` → *Open with Live Server*.

**Option B:** double-click `start.cmd` — it serves the folder and opens the browser.

**Option C:** `py serve.py 8080` in this folder, then <http://localhost:8080>.

> The custom `serve.py` sends `Cache-Control: no-store`. Python's stock `http.server`
> does not, and browsers will then happily serve you a stale `state.js` while you edit —
> which looks exactly like "my code changes do nothing".

> ES modules require `http://`. Opening `index.html` directly from disk will not work — the page will tell you so.

Rules tests: <http://localhost:8080/tests.html>

## What exists today

| Area | Status |
|---|---|
| Seeded, rotationally symmetric map generation | ✅ |
| Terrain: rock, web, moss, nest | ✅ |
| Pathfinding, movement budgets, flyers, climbers | ✅ |
| Line of sight | ✅ |
| Full counter-web damage maths with itemised modifiers | ✅ |
| Abilities: Legion, Splinter, Horn Charge, Execution, Pierce/Dive, Acid Spray, Web Shot, Pollen | ✅ |
| Statuses: webbed, frenzied | ✅ |
| Turn flow, selectable victory (Hive assault / Elimination), 30-round cap | ✅ |
| Rendering + inspection UI | ✅ |
| Click-to-play: select, move, attack, abilities, end turn | ✅ |
| Animated movement, lunges, floating damage, hit flashes | ✅ |
| Drone AI opponent (greedy: kills, webs, heals, advances) | ✅ |
| AI vs AI auto-battle (same drone, both sides) | ✅ basic |
| Human vs human hot seat (both armies built and deployed on one device) | ✅ |
| 120-point army builder with presets and live validation | ✅ |
| Manual deployment in your two home rows | ✅ |
| AI army generated inside the same budget | ✅ |
| Negamax AI + evaluation | Stage 4 |
| Spectator polish (eval bar, AI reasoning panel) | Stage 5 |
| Balance simulation harness | Stage 6 |

## Controls

**Menu / army builder**

- **Click a species card** — add one to your 120-point army (max 10 units).
- **Army chips** — remove one of that species.
- **Presets** — Balanced, Swarm, Iron Wall, Ambush.
- **Battle type** — **Human vs AI**, **Hot seat** (two humans on one device) or **AI vs AI**.
- **Win condition** — **Hive assault** wins by destroying the enemy Hive; **Elimination** wins by destroying every enemy unit, and Hives cannot be attacked.
- **Hot seat armies** — switch between *Player 1 · Hollow* and *Player 2 · Ember* with the army tabs, and build a legal 120-point list for each.
- **Deploy army** opens the deployment screen. **AI vs AI** skips it and auto-places both colonies.

**Deployment**

- **Click a tray species**, then a highlighted tile in your two home rows.
- **Click a placed unit** to pick it back up.
- **Auto-place** uses the drone's spread-out formation. **Clear** empties your zone.
- **Confirm deployment** starts the battle; `Esc` clears the selected species, then returns to the menu.
- **Hot seat** deploys sequentially: Player 1 places in rows 6–7 and continues, then Player 2 places in rows 0–1 and starts the battle.

**Battle**

- **Click your unit** — see its blue move tiles, red attack targets and purple ability targets.
- **Click a blue tile** — move (the unit may still attack afterwards).
- **Click a red-ringed enemy** — attack. Hover first to preview the damage, including `lethal`.
- **Ability button** in Orders — then click a highlighted target. Click it again or press `Esc` to cancel.
- **Attack then move** is legal — a unit gets one move and one action per turn, in either order.
- **Next unit / Skip unit** — cycle through the army, or mark one as done.
- **End turn** — auto-fires when every unit has both moved and acted.
- **Hot seat** — the sidebar names the active player; pass the device after each end turn. No AI acts in this mode.

## Win conditions

| Variation | Objective | Hives |
|---|---|---|
| **Hive assault** (default) | Destroy the enemy Hive | Targetable objectives |
| **Elimination** | Destroy every enemy unit | Protected scenery — cannot be attacked |

Both variations fall back to army value if the 30-round cap is reached. In Elimination, wiping out both armies is a draw.

## The board

10 × 8 tiles, 8-way movement (diagonal = 1 step), every map mirrored 180° so neither side starts with terrain advantage.

| Terrain | Effect |
|---|---|
| Rock spire | blocks movement and line of sight (spiders climb it, flyers cross it) |
| Web | costs 2 to enter (1 for climbers, free for flyers) |
| Moss cover | −40% incoming ranged damage |
| Nest mound | +15% damage dealt, −15% damage taken |

## Roster

| Unit | Role | Pts | HP | Move | Rng | Dmg | Arm | Signature |
|---|---|---|---|---|---|---|---|---|
| Ant Soldier | Swarm | 10 | 14 | 3 | 1 | 5 | 0 | Legion: +2 dmg per other ant beside the target (max +4) |
| Termite | Swarm | 14 | 16 | 3 | 1 | 6 | 1 | Splinter: 50% splash to enemies beside the target |
| Rhino Beetle | Bruiser | 22 | 32 | 2 | 1 | 10 | 3 | Horn Charge: after a 2-tile run-up, +50% and knockback |
| Mantis | Assassin | 20 | 16 | 4 | 1 | 12 | 0 | Execution: +8 vs targets at ≤50% HP |
| Wasp | Skirmisher | 16 | 12 | 5 (fly) | 1 | 7 | 0 | Pierce: ignores armour. Dive: +25% after 3 tiles |
| Stag Beetle | Bruiser | 20 | 28 | 3 | 1 | 8 | 2 | Horn Charge: after a 2-tile run-up, +50% and knockback |
| Dragonfly | Skirmisher | 16 | 12 | 5 (fly) | 1 | 7 | 0 | Pierce: ignores armour. Dive: +25% after 3 tiles |
| Bombardier | Artillery | 18 | 14 | 2 | 2–3 | 9 | 1 | Acid Spray: 50% splash. Cannot hit flyers; volatile up close |
| Spider | Controller | 17 | 18 | 4 | 1 (web 2) | 5 | 1 | Web Shot: half movement, no abilities, +15% damage taken |
| Bee | Support | 15 | 12 | 4 (fly) | 1 | 3 | 0 | Pollen: heal 6 or grant +2 damage |

Counter web (attacker multipliers): swarm → bruiser 1.35 · artillery → swarm 1.40 · assassin → artillery/support 1.40 · skirmisher → artillery 1.35, bruiser 1.20 · bruiser → assassin/skirmisher 1.25 · controller → bruiser 1.20.

## Damage formula

```
damage = max(1, floor(base × Π multipliers + flat bonuses) − armour)
```

Multipliers include the role counter, flanking (+20%), swarming (+10% per extra adjacent ally), nest mounds, entanglement, volatile carcasses and unit passives. Every step is recorded in `breakdown.steps`, which is what the UI and the AI will read.

## Files

```
index.html            menu + battlefield
tests.html            in-browser regression suite
start.cmd             zero-install local server
serve.py              static server with no-store caching
css/style.css
js/main.js            boot, army menu, deployment, battle loop, AI turns
js/core/rng.js        seeded mulberry32
js/core/board.js      grid, terrain, Dijkstra, LOS
js/core/combat.js     damage formula + counter table
js/core/state.js      game creation, armies, deployment, turn flow, victory
js/core/actions.js    legal actions and mutations
js/data/units.js      roster, stats, counter web
js/data/maps.js       symmetric map generator
js/ai/drone.js        Stage-2 greedy opponent
js/render/sprites.js  procedural insect art
js/render/fx.js       tweens, floaters, hit effects
js/render/renderer.js canvas renderer
js/ui/hud.js          sidebar + orders panel
js/ui/army.js         point-buy army builder
js/tests/             harness + suite
```

## Roadmap

- **Stage 4** — evaluation (piece values, threat/pressure maps, piece-square tables) and negamax AI with alpha-beta for both win conditions, 3 difficulties.
- **Stage 5** — spectator polish: eval bar, AI reasoning panel, auto-battle speed control.
- **Stage 6** — batch balance harness, win-rate matrix, tuning report.
