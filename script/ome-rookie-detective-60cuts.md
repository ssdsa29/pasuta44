# 『青梅西署、事件です(たぶん)』60カット版

3分尺 / 60カット / 基本3秒(73フレーム)

36ビート版からの拡張。各ビートに**寄りと引きの2ショット**を与えるカバレッジ方式で
60カットに展開した。実写の撮影と同じ考え方で、編集のリズムが良くなり、
かつ生成時間が18時間 → 約12時間に短縮される。

- `[HARU]` はキャラLoRAのトリガーワードに置き換える
- 全カットのIMGに脱AI語を付与する(`docs/production-spec.md` 参照)
- **尺**: 無印=3秒(73f) / `[2s]`=2秒(49f) / `[5s]`=5秒(121f、感情のピークのみ)
- **(NP)** = 人物が写らないカット(29本)。LoRA完成前に着手できる

---

## 第1幕 憧れと現実 (0:00-0:50) 17カット

### C01 (NP) 青梅の夜明け・遠景
- IMG: `A wide aerial view of a river valley in the mountains of western Tokyo at dawn, morning mist over the water, forested ridges layered into the distance, a small town below, soft golden light breaking over the ridgeline, cinematic landscape, muted natural colors, 35mm film grain.`
- MOV: `The camera is completely static. Mist drifts slowly across the valley, light gradually brightening.`

### C02 (NP) [2s] 多摩川の水面
- IMG: `Close-up of a shallow river surface at dawn, clear water running over smooth stones, morning mist just above the surface, cold blue light, shallow depth of field, 35mm film grain.`
- MOV: `The camera is static. Water flows continuously over the stones, mist drifting.`

### C03 (NP) ハルの部屋・壁
- N: 「刑事になりたかった。ずっと」
- IMG: `A Japanese bedroom wall completely covered with crime-drama posters and yellowed newspaper clippings pinned in overlapping layers, the printed text too small and out of focus to read, thin dawn light from a curtain gap, handheld documentary photography, warm muted palette, film grain.`
- MOV: `The camera is static. Dust motes float slowly through the light beam.`

### C04 (NP) [2s] 目覚まし時計
- IMG: `Extreme close-up of an old analog alarm clock on a cheap wooden desk, the hands pointing to just before six, dim blue dawn light, very shallow depth of field with the dial face partly out of focus, film grain.`
- MOV: `The camera is static. The colon between the digits blinks steadily.`

### C05 鏡の前・引き ★基準カット
- IMG: `[HARU], a young Japanese woman in her early twenties with straight black hair and blunt bangs, standing in front of a bathroom mirror holding up a police notebook with both hands in a dramatic pose, grey suit jacket over a white shirt, intensely serious expression, plain tiled bathroom, cool morning light, candid photography, film grain.`
- MOV: `The camera is completely static on a tripod. She holds the pose, breathing, shoulders slightly rising.`

### C06 鏡の前・寄り
- S: ハル「……よし」
- IMG: `Close-up of the face of a young Japanese woman reflected in a bathroom mirror, intensely serious determined expression slowly breaking, cool morning light from one side, shallow depth of field, candid photography, film grain.`
- MOV: `The camera is static. Her serious expression holds, then breaks into a small embarrassed grin. She blinks once.`

### C07 (NP) 青梅署 外観
- IMG: `A small single-story suburban Japanese police station on a quiet street, cherry blossom tree beside the entrance, a few bicycles parked out front, low mountains behind, overcast soft daylight, documentary photography, muted colors, film grain.`
- MOV: `The camera is static. Cherry petals drift down slowly, a car passes in the far background.`

### C08 (NP) [2s] 署の看板
- IMG: `A weathered vertical sign plate mounted on a concrete gatepost outside a small Japanese police station, the sign reading "青梅西署" in four large black characters on white, slightly faded paint, overcast daylight, shallow depth of field, film grain.`
- MOV: `The camera is static. The shadow of a branch moves slightly across the sign.`

### C09 廊下を歩く
- IMG: `A young Japanese woman in a grey pantsuit walking down a dim police station corridor seen from behind, police notebook on a lanyard, shoulders squared with determination, fluorescent overhead lighting, documentary photography, film grain.`
- MOV: `The camera is static as she walks away down the corridor, footsteps steady.`

### C10 ドアの前
- S: ハル「本日付で配属になりました、如月ハルです!」
- IMG: `[HARU] standing at a sliding office door with her hand on the handle, taking a deep breath, eyes forward, grey pantsuit, fluorescent corridor lighting, documentary photography, film grain.`
- MOV: `The camera is static. She inhales deeply, squares her shoulders, then slides the door open.`

### C11 (NP) 書類の山が置かれる
- S: 先輩(声のみ)「じゃ、これ全部ハンコ」
- IMG: `A thick stack of paper documents being dropped onto a cluttered office desk by a pair of hands, low angle, other desks and filing cabinets blurred behind, harsh fluorescent lighting, documentary photography, film grain.`
- MOV: `The camera is static. The stack lands heavily, papers settling, a few sheets sliding sideways.`

### C12 固まるハル・寄り
- IMG: `Close-up of [HARU], her bright smile frozen in place, eyes slowly widening as she stares off-camera, fluorescent office lighting, blurred office background, candid photography, shallow depth of field, film grain.`
- MOV: `The camera is completely static. Her frozen smile holds, then one eyebrow twitches. She blinks slowly.`

### C13 (NP) ハンコ作業
- IMG: `Extreme close-up of a hand stamping a red seal onto official documents, ink pad beside it, repeated stamp marks on papers, harsh overhead light, shallow depth of field, documentary photography, film grain.`
- MOV: `The camera is static. The hand stamps rhythmically, again and again.`

### C14 (NP) [2s] 積み上がる書類
- IMG: `A stack of stamped documents growing taller on an office desk, seen from a low side angle, fluorescent light, film grain.`
- MOV: `The camera is static. A hand enters frame and adds another sheet to the pile.`

### C15 (NP) 窓の外
- IMG: `View through an office window of quiet green mountains and clear sky, a bird crossing the frame, a dusty blind in the foreground, soft natural daylight, documentary photography, muted natural palette, film grain.`
- MOV: `The camera is static. A bird glides across, leaves swaying gently.`

### C16 机に突っ伏す・引き
- IMG: `[HARU] slumped face-down on an office desk covered in documents, still holding a stamp in one limp hand, other officers working in the blurred background, fluorescent lighting, candid documentary photography, film grain.`
- MOV: `The camera is static. She lies motionless, then her shoulders rise and fall with a long breath.`

### C17 突っ伏したハル・寄り
- N: 「事件は……どこですか」
- IMG: `Close-up of the face of [HARU] resting sideways on a desk surface, cheek pressed against papers, eyes open and staring blankly, fluorescent lighting, shallow depth of field, film grain.`
- MOV: `The camera is static. She stares blankly, blinks once slowly, and exhales, ruffling a nearby paper.`

---

## 第2幕 雑務モンタージュ (0:50-1:40) 17カット

### C18 畑の獣害・引き ★伏線
- S: 農家の老人「イノシシだよ、たぶん」
- IMG: `[HARU] crouching in a vegetable field holding a measuring tape against animal tracks in the mud, grey suit with sleeves pushed up and rubber boots, an elderly farmer standing behind pointing, overcast daylight, rural documentary photography, film grain.`
- MOV: `The camera is static. She measures carefully, then looks up at the farmer.`

### C19 (NP) 足跡の寄り ★伏線の核
- IMG: `Extreme close-up of animal tracks pressed into wet field mud, a yellow measuring tape laid beside them for scale, overcast daylight, high detail, forensic documentary photography, film grain.`
- MOV: `The camera is static. A hand adjusts the measuring tape slightly.`

### C20 手帳に記録
- IMG: `[HARU] writing carefully in a police notebook while crouching in a field, brow furrowed in concentration, pencil sketching tread patterns, overcast daylight, shallow depth of field, film grain.`
- MOV: `The camera is static. Her hand moves steadily across the page, she glances down at the ground and back.`

### C21 迷い犬・格闘
- IMG: `[HARU] awkwardly carrying a struggling medium-sized dog through a quiet residential street, suit jacket rumpled, hair coming loose, determined but flustered expression, soft overcast daylight, candid documentary photography, film grain.`
- MOV: `The camera is static. The dog squirms, she staggers a step sideways, adjusting her grip.`

### C22 [2s] 犬に舐められる
- IMG: `Close-up of the face of [HARU] as a dog licks her cheek, her eyes squeezed shut in resignation, messy hair, outdoor daylight, candid photography, shallow depth of field, film grain.`
- MOV: `The camera is static. She squeezes her eyes shut and turns her face away slightly.`

### C23 防犯登録の確認 ★伏線
- IMG: `[HARU] crouching beside a parked bicycle on a sidewalk, closely examining a small registration sticker on the frame with intense concentration, notebook in her other hand, afternoon daylight, documentary photography, shallow depth of field, film grain.`
- MOV: `The camera is static. She leans in closer to read the sticker, then writes in her notebook.`

### C24 (NP) 登録シールの寄り ★伏線の核
- IMG: `Extreme close-up of a small bicycle registration sticker on a metal frame, a printed number partly visible, scratched surface, afternoon daylight, shallow depth of field, film grain.`
- MOV: `The camera is static. A slight shift of light moves across the metal surface.`

### C25 (NP) 傘の山
- IMG: `A shelving unit overflowing with dozens of lost umbrellas of all colors in a dim storage room, a single bare bulb overhead, documentary photography, film grain.`
- MOV: `The camera is static. One umbrella slowly slides and tips over.`

### C26 傘に埋もれる
- N: 「これも、刑事の仕事なんですか」
- IMG: `[HARU] standing in front of an overflowing umbrella shelf holding two umbrellas, looking overwhelmed, dim storage room, single bare bulb, documentary photography, film grain.`
- MOV: `The camera is static. She lifts one umbrella and a section slides off the shelf toward her.`

### C27 山道で道案内
- IMG: `[HARU] on a mountain trail holding an open paper map, explaining directions to two hikers with backpacks, bright natural smile, tall cedar forest, dappled sunlight, documentary photography, film grain.`
- MOV: `The camera is static. She points off toward a trail, the hikers nod.`

### C28 (NP) [2s] 杉林の光
- IMG: `Sunbeams filtering through a dense cedar forest onto a dirt trail, dust and pollen visible in the light shafts, deep green shadows, cinematic natural lighting, film grain.`
- MOV: `The camera is static. Dust motes drift through the light shafts, leaves shifting.`

### C29 祭りの交通整理
- IMG: `[HARU] directing traffic with a glowing red baton at a small local summer festival at dusk, paper lanterns strung overhead, families walking past, warm lantern light against a blue evening sky, documentary photography, film grain.`
- MOV: `The camera is static. She waves the baton in steady arcs, glancing at the crowd.`

### C30 (NP) 提灯
- IMG: `A row of glowing red paper lanterns strung across a narrow festival street at dusk, warm light, blurred crowd behind, shallow depth of field, film grain.`
- MOV: `The camera is static. The lanterns sway very slightly in the breeze.`

### C31 深夜の刑事課
- IMG: `[HARU] alone at a desk in a dark police office late at night, a single desk lamp lighting her face and a stack of documents, everyone else gone, windows black, moody low-key lighting, documentary photography, film grain.`
- MOV: `The camera is static. She stamps a document, pauses, and rubs her eyes with the back of her wrist.`

### C32 (NP) 手帳の中身 ★伏線の要
- IMG: `Close-up of an open police notebook filled with neat handwritten Japanese notes, a careful pencil sketch of tread patterns, and rows of bicycle registration numbers, a pen resting on the page, warm desk lamp light, shallow depth of field, film grain.`
- MOV: `The camera is static. A hand turns the page slowly, revealing more notes and sketches.`

### C33 先輩が缶コーヒーを置く
- IMG: `A middle-aged detective in a rumpled shirt setting a can of coffee on a desk without looking, already walking away, a young woman looking up in surprise, dim night office, documentary photography, film grain.`
- MOV: `The camera is static. He sets the can down and walks out of frame, she watches him go.`

### C34 缶コーヒーを持つ・寄り
- IMG: `Close-up of [HARU] holding a warm can of coffee with both hands at her desk, looking down at it with a small tired smile, desk lamp light on her face, night office darkness behind, candid photography, shallow depth of field, film grain.`
- MOV: `The camera is static. She wraps both hands around the can, closes her eyes briefly, exhales.`

---

## 第3幕 事件 (1:40-2:35) 18カット ★トーン転換

**この幕だけ寒色・高コントラスト・シネマティックを強める。**

### C35 (NP) [2s] 無線のランプ
- 音: 無線「青梅管内、住居侵入盗の通報」
- IMG: `A police radio unit on a desk with its indicator light suddenly glowing red in a dark office, sharp shadows, cold blue-tinted night lighting, tense atmosphere, cinematic close-up, film grain.`
- MOV: `The camera is static. The indicator light pulses sharply.`

### C36 [2s] 顔が上がる
- IMG: `Close-up of [HARU] at a dark desk, her head snapping up, eyes suddenly sharp and alert, desk lamp light from below, cold night tones, cinematic close-up, film grain.`
- MOV: `The camera is static. Her head lifts sharply, eyes widening and focusing.`

### C37 廊下を走る
- IMG: `[HARU] sprinting down a dim police corridor at night, notebook clutched in one hand, jacket flying open, motion blur, harsh fluorescent lights streaking past, dynamic cinematography, cold blue tones, film grain.`
- MOV: `The camera is fixed in place as she runs directly toward and past it, lights streaking.`

### C38 (NP) 現場外観
- IMG: `A quiet suburban Japanese house at night with a police car parked outside, red emergency lights sweeping across the wall and hedge, a few neighbors watching from a distance, cinematic night photography, desaturated cool palette, film grain.`
- MOV: `The camera is static. Red light rotates rhythmically across the frame.`

### C39 (NP) [2s] 割れた窓
- IMG: `A broken window pane on a suburban house at night, jagged glass edges catching the sweep of red emergency light, dark interior beyond, cinematic crime scene photography, cold tones, film grain.`
- MOV: `The camera is static. Red light sweeps across the broken glass.`

### C40 懐中電灯で庭を照らす
- IMG: `[HARU] sweeping a flashlight beam across a dark garden, her face lit from below by reflected light, completely serious focused expression, night, cold blue tones, cinematic crime-scene photography, film grain.`
- MOV: `The camera is static. The flashlight beam sweeps slowly across the ground, her eyes tracking it.`

### C41 (NP) 足跡を発見
- IMG: `A clear shoe print pressed into soft garden soil, lit harshly by a flashlight beam from one side, night, high contrast, forensic photography, film grain.`
- MOV: `The camera is static. The flashlight beam steadies on the print and holds.`

### C42 (NP) メジャーを当てる
- IMG: `A hand laying a yellow measuring tape beside a shoe print in soil, a flashlight beam illuminating both, night, high contrast, forensic photography, film grain.`
- MOV: `The camera is static. The hand carefully positions the measuring tape.`

### C43 気づく ★転換点
- IMG: `Close-up of [HARU] at night, eyes widening in sudden realization, flashlight glow from below, cold night tones, cinematic close-up, shallow depth of field, film grain.`
- MOV: `The camera is completely static. Her eyes widen, she goes very still, then draws a sharp breath.`

### C44 (NP) 手帳を開く ★伏線回収
- IMG: `Hands snapping open a police notebook to a page showing a pencil sketch of tread patterns, a flashlight beam across the page, night, high contrast, film grain.`
- MOV: `The camera is static. The notebook flips open, pages settling.`

### C45 (NP) 照合
- IMG: `A pencil sketch of tread patterns in an open notebook held directly above soil where the identical tread pattern is pressed, a flashlight beam across both, forensic comparison, night, high detail, film grain.`
- MOV: `The camera is static. The notebook is held steady above the print, the hand trembling very slightly.`

### C46 先輩に報告
- S: ハル「この靴、先週の畑の現場と同じです」
- IMG: `[HARU] speaking urgently to an older detective at a night crime scene, gesturing at her notebook, the man's skeptical expression shifting to sharp attention, red police lights washing over them, cinematic night photography, film grain.`
- MOV: `The camera is static. She gestures at the notebook, he leans in, his expression sharpening.`

### C47 [2s] 先輩の顔
- IMG: `Close-up of a middle-aged detective at a night crime scene, expression shifting from skepticism to serious recognition, red emergency light sweeping across his features, cinematic night photography, film grain.`
- MOV: `The camera is static. His eyes narrow, then widen slightly as he understands.`

### C48 (NP) 乗り捨てられた自転車 ★伏線回収
- IMG: `An abandoned bicycle lying on its side in a narrow dark alley, a flashlight beam picking out the small registration sticker on its frame, wet asphalt reflecting light, night, cold tones, cinematic detail shot, film grain.`
- MOV: `The camera is static. The flashlight beam finds the sticker and holds on it.`

### C49 (NP) [2s] 登録番号
- IMG: `Extreme close-up of a bicycle registration sticker under a harsh flashlight beam at night, the printed number clearly visible, wet metal frame, high contrast, film grain.`
- MOV: `The camera is static. Water droplets on the metal catch the light.`

### C50 路地を走る
- IMG: `[HARU] running through a narrow dark alley at night, breath visible in the cold air, one hand on her radio, intense focused expression, harsh streetlight from behind casting a long shadow, dynamic cinematic night photography, film grain.`
- MOV: `The camera is fixed as she runs toward it through the alley, breath clouding.`

### C51 (NP) 懐中電灯が集まる
- IMG: `The far end of a dark alley where several flashlight beams converge on a single figure, silhouettes of police officers closing in, dust and breath visible in the light beams, high contrast night photography, cinematic, film grain.`
- MOV: `The camera is static. The beams converge and steady, silhouettes moving in from both sides.`

### C52 [2s] 息を切らすハル
- IMG: `Close-up of [HARU] breathing hard at night, breath clouding in the cold, strands of hair stuck to her damp forehead, flashlight glow from the side, cold tones, cinematic, film grain.`
- MOV: `The camera is static. She breathes hard, chest rising, then slowly steadies.`

---

## 第4幕 日常へ (2:35-3:00) 8カット

### C53 (NP) 夜明け
- IMG: `Dawn breaking over a quiet Japanese residential street with low tiled-roof houses and utility poles, a white and black Japanese police car with its emergency lights just switched off, pale morning sky, empty narrow road, exhausted calm atmosphere, cinematic wide shot, muted cool-to-warm gradient, film grain.`
- MOV: `The camera is static. The sky slowly brightens, a single bird crosses overhead.`

### C54 先輩が肩を叩く
- S: 先輩「……よくやった」
- IMG: `An older detective walking past a young woman and giving her shoulder a brief pat without eye contact, both looking exhausted, pale dawn light outside a police station, documentary photography, film grain.`
- MOV: `The camera is static. He pats her shoulder and keeps walking out of frame.`

### C55 [5s] ハルの顔 ★感情のピーク
- IMG: `Close-up of the exhausted face of [HARU] in pale dawn light, dark circles under her eyes, messy hair, a slow genuine smile beginning to spread, soft natural morning light, candid photography, shallow depth of field, film grain.`
- MOV: `The camera is completely static. She stands still, breathing. Her tired expression holds, then a small smile begins at one corner of her mouth and spreads unevenly across her face. Her eyes crinkle. She blinks once, slowly.`

### C56 (NP) [2s] 朝の署内
- IMG: `An empty Japanese police station office in early morning light, grey steel desks pushed together facing each other, stacked document trays and a wall of files, sunlight through horizontal blinds casting stripes across the desks, dust in the air, quiet documentary photography, warm morning tones, film grain.`
- MOV: `The camera is static. Dust drifts through the light stripes.`

### C57 (NP) また書類の山
- S: 先輩(声のみ)「じゃ、報告書な。事件の分も追加で」
- IMG: `An even taller stack of documents dropped onto a grey steel desk in a Japanese police station office in the morning, sunlight through blinds, the stack almost comically high, documentary photography, warm morning light, film grain.`
- MOV: `The camera is static. The stack lands heavily, a few sheets sliding off the top.`

### C58 固まるハル・再び
- IMG: `Close-up of [HARU] staring at a huge stack of paperwork, exhausted, her expression completely blank, morning sunlight through blinds across her face, candid photography, film grain.`
- MOV: `The camera is static. She stares blankly, blinks twice, her eye twitching slightly.`

### C59 笑ってハンコを取る
- IMG: `[HARU] laughing quietly at her desk while reaching for her stamp, a resigned but warm smile, a huge stack of documents beside her, morning sunlight through blinds, candid photography, film grain.`
- MOV: `The camera is static. She laughs quietly, shakes her head slightly, and picks up the stamp.`

### C60 [5s] ラスト・引き
- N: 「事件は、たぶん、ここからも始まる」
- IMG: `A wide shot of a quiet Japanese police station office in morning light, [HARU] alone at a grey steel desk stamping documents, empty desks around her, sunlight through blinds, mountains faintly visible through the window, documentary photography, warm muted palette, film grain.`
- MOV: `The camera is completely static. She stamps documents steadily. Dust drifts in the sunlight. Nothing else moves.`

---

# 集計

| 区分 | カット数 | 秒数 |
|---|---|---|
| 3秒(73f) | 46 | 138 |
| 2秒(49f) | 12 | 24 |
| 5秒(121f) | 2 | 10 |
| **合計** | **60** | **172秒** |

タイトルとエンドカードで8秒を足して**約3分**。

## 人物が写らないカット = 29本(48%)

```
C01 C02 C03 C04 C07 C08 C11 C13 C14 C15 C19 C24 C25 C28
C30 C32 C35 C38 C39 C41 C42 C44 C45 C48 C49 C51 C53 C56 C57
```

**LoRAの完成を待たずに着手できる。** 先にここを全部作れば、
LoRA学習(4〜8時間)の待ち時間が無駄にならない。

## 生成時間の見積もり

| 尺 | 本数 | 単価 | 小計 |
|---|---|---|---|
| 3秒 | 46 | 13分 | 598分 |
| 2秒 | 12 | 7分 | 84分 |
| 5秒 | 2 | 30分 | 60分 |
| | | **合計** | **約12.4時間** |

リトライ30%を見込んで**約16時間**。一晩で回り切る。

## 制作順序

1. **人物なし29カット**を先に量産(LoRA不要、いますぐ着手可)
2. C05(鏡)でキャラの見え方を確定
3. LoRA学習と並行して、人物なしカットの動画化を回す
4. LoRA完成後、人物ありの33カットのキーフレームを生成
5. 全カットの動画化
6. 音声(セリフ・ナレーション・BGM)
7. ffmpegで結合
