# What Bedrock cannot do, and what stands in for it

Java behaviour that the Bedrock add-on system (stable Script API, no experiments) cannot reproduce as it is, and the
replacement used. Japanese summary at the end.

| Java | Why not on Bedrock | Bedrock replacement |
|---|---|---|
| Machine screens (slots, gauges, buttons) | No custom container screens for blocks | Empty-hand tap opens a form: status (energy, progress, tanks), a button per slot to take it out, "Put in" for the held item, the machine's own buttons (Print…, Settings, Trades). Tapping with an item the machine takes puts it straight in. Hoppers pointing in feed it; outputs go into the container below (or drop), as in Java. |
| Storage Barrel screen | Same | A form: contents paged (24 a page) with counts over 64; take 1 / a stack / 4 stacks / all; put in all of the held item or the whole inventory (hotbar kept); sort and reverse. |
| Sort button on vanilla chests | Vanilla screens can't be changed | Sneak + empty hand on a chest, barrel or shulker box sorts it; again within 2 s sorts it the other way. Not the Ender Chest (scripts can't reach it). |
| Custom fluids (oil, mercury, liquid experience as flowing blocks) | No custom fluids | Liquids are numbers (mB) in tanks. Buckets/bottles pour in and draw out by tapping. Placed mercury / liquid experience blocks are not made. |
| Pipe buffers and per-side pull/off | — | Pipes hold nothing: a holder that gives pushes through the network into holders that take. Valves shut the way. |
| Comparators reading machines | Custom blocks give no comparator signal | None. (Redstone *output* works: buttons, pressure plates, Nested Timer, Hub Stone through `minecraft:redstone_producer`.) |
| Enchantments (Rootbound, Earthmover) | No custom enchantments | Rootbound: sneak-use an axe on a sapling to mark it Rootbound (kept on the axe); felled trees are replanted from the inventory (one sapling, the 1-wide case). Earthmover: not made. |
| Spawner Controller changing vanilla spawners | Scripts can't read or change a spawner | The controller is a spawner of its own: put a filled Mob Bottle in it; it brings forth that mob beside each Spawner Link Sender paired with the receiver under it (sneak... tap a sender, then the receiver), by its settings and Java's energy cost. |
| Trading Counter using the villager's own offers | Scripts can't see or make villager trades | Each profession has a fixed list of its usual first-tier trades; tick which ones the counter makes. |
| Barter Terminal's sealed room with Nether air | Can't stop piglins zombifying | Grown piglins within 6 blocks take its gold (one each per 119 ticks) and the barter (vanilla's table) goes in its outputs. Keep them in the Nether or in boats. |
| The If (an overworld from another seed) | No custom dimensions | A far part of this overworld (1–3 million blocks out) picked by six dice: fresh ground. Slow falling on arrival; a mirror is set there to come home. |
| Dock-a-Daemon Door's wall check | — | Not checked: any door works as a gate. |
| Dark Matter's night at noon | Light can't be taken away | Players within 7 blocks get Darkness. |
| Warp Anchor cancelling teleports | No teleport event | Endermen/shulkers in the box are put back where they were; pearls entering it are removed. |
| Squint (zoom key) | No key bindings or FOV control | Not made (a spyglass does it). |
| Camera photos | Scripts can't read the screen | Not made. |
| Posters as one item with a design | Item data needs unstackable items | One item per design (69); the poster on the wall is an entity per size with the design as a property. |
| Labels showing the item's picture | Can't draw an item's icon on an entity | A plaque that shows the label item's name (rename it at an anvil). |
| Thin Rope/Chain spans that sag, things hung drawn on them | — | Straight spans. Filament Bulbs and lanterns hung on them light the place (invisible light block) but aren't drawn; fish and kelp hung there dry (taken off with an empty hand). |
| Climbable Rope | Custom blocks can't be climbable | Inside a Rope: jump to rise, sneak to hold, otherwise slide down slowly. |
| Drive belts drawn round the wheels | — | Drawn as a straight span between wheel centres. |
| Dawnwood signs with text | Custom blocks hold no text | The text floats in front of the sign (edit with an empty hand). |
| Dawnwood boats | Boats can't take a new wood | They set down the game's own boat / chest boat. |
| Standing Mirror's reflection | No render-to-texture | Shining glass only. |
| Books drawn in piles/rows | Java draws them with a renderer | One book model; the books are kept and given back. |
| Oil Can silencing vanilla doors | Vanilla sounds can't be stopped | Marks the block; our own (Dawnwood/Motor) sounds respect it. |
| Fireproof Coating | No fire-spread event | Fire next to a coated block is put out at once. |
| Collision shapes | One box per block, max 16 px | Boxed shapes; fences 1 block high. |
| Neighbour updates | No neighbour event | Shapes are worked out again when a player places or breaks a block next to them. |
| Fuel values / furnace recipes for scripts | Not queryable | Tables: vanilla burn times; smelting recipes read from the Java data at build. |
| Bedrock random ticks (⅓ of Java's) | — | Crop chances ×3. |
| Per-world part switches, claims, other mods | — | Everything on; settings in `/nookworks:settings` (operators) or `/scriptevent nookworks:settings`. |
| Languages | — | Japanese (and English as the base). Others fall back to English for Bedrock-only text (the author plays in Japanese). |

## 日本語まとめ
- 専用画面 → フォーム（素手でタップ）。持っているアイテムでタップすると直接投入。ホッパー入力と下への出力は Java と同じ。
- バニラのチェスト整頓 → スニーク＋素手でタップ（2秒以内にもう一度で逆順）。
- 液体 → 数値（mB）。バケツ・瓶で注ぐ／汲む。パイプは出す側から受ける側へ流すだけ。
- レッドストーン出力（ボタン・感圧板・タイマー・ハブストーン）は対応。コンパレーターでの読み取りは不可。
- Rootbound → 斧をスニークで苗木に使うと付く。スポナー制御 → モブ瓶を入れると、その生き物を湧かせる装置。取引カウンター → 職業ごとの定番取引から選ぶ。
- イフ → サイコロ6回で決まる、遠く離れた同じ世界の未開地。
- ポスター → 柄ごとのアイテム。ラベル → 名札（金床で名前を付ける）。ロープ → まっすぐの張り。電球・ランタンは光るが絵は出ない。
- 看板 → 文字は看板の前に浮かぶ名前として表示。ボート → バニラのボート。姿見は映らない。
