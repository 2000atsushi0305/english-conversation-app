# 6キャラ画像生成プロンプト（DALL-E 3 / ChatGPT 用）

## 使い方

1. **ChatGPT（DALL-E 3 / GPT-Image-1）または Midjourney** で1キャラずつ生成
2. 生成された画像を**透過PNG**でダウンロード
3. ファイル名を指定通りに揃えて、`/public/characters/` に配置
4. 生成完了後、takkさんから「揃った」と教えてください → 私がフロントを更新してキャラ画像を表示します

---

## 共通スタイル指針（全6キャラで統一）

| 項目 | 指定 |
|------|------|
| **アートスタイル** | ミニマルかわいい、フラットイラスト、線が柔らかい |
| **体型** | 丸いボバ（タピオカミルクティー）カップ型、頭部 = 顔、上部に小さな耳のような突起 |
| **構図** | 正面、上半身（頭部のみ）、中央配置 |
| **目** | 同じ位置・同じサイズ（やさしいシンプルな半円のような線、または小さい黒点）|
| **口** | 控えめな笑顔（小さなカーブ） |
| **頬** | 桜パール色のチーク（控えめに） |
| **背景** | 透明（transparent） — 透過PNG必須 |
| **画像サイズ** | 1024×1024 正方形 |
| **品質** | high / HD |

> 💡 ChatGPT への共通指示として「同じシリーズで6体作るので、ポーズ・サイズ・体型・線の太さは完全に揃えて、色とアクセサリだけ変えてください」と必ず伝えてください。

---

## 共通プレフィックス（毎回コピーして使う）

```
A cute minimalist boba milk-tea character mascot, 
front-facing portrait of head and shoulders only, 
round cup-shaped body with two small ear-like protrusions on top, 
gentle small eyes and tiny soft smile, 
soft pink sakura blush on cheeks, 
flat illustration style with soft thin lines, 
kawaii Japanese style, 
centered composition, 
transparent background (PNG with alpha channel), 
1024x1024 square, high quality, vector art feel.

Same exact body shape, proportions, and line weight across all 6 characters in this series. 
Only color, accessory, and topping vary per character.
```

---

## 1. ミルクボバ 🫧

**ファイル名**: `milk.png`

```
[共通プレフィックス] + 
Character: "Milk Boba" — the gentle one.
Body color: creamy milk beige (#F5DCC6 base with subtle #A07B52 shadow gradient).
Accessory: plain, no accessory — just three small tapioca pearls (dark brown #3D2615) floating above the head.
Vibe: calm, soft, peaceful — like a warm cup of milk tea on a quiet morning.
```

---

## 2. 抹茶ボバ 🍵

**ファイル名**: `matcha.png`

```
[共通プレフィックス] + 
Character: "Matcha Boba" — the studious one.
Body color: matcha green (#7AA86B base with #4A6740 shadow gradient).
Accessory: small round eyeglasses (thin black frames) AND a tiny matcha whisk (chasen) or sprinkle of matcha powder on top of the head.
Vibe: gentle scholar, refined, like a Kyoto tea-ceremony master in cute form.
```

---

## 3. 黒糖ボバ 🔥

**ファイル名**: `kokutou.png`

```
[共通プレフィックス] + 
Character: "Kokutou Boba" — the energetic one.
Body color: dark caramel brown (#4A2F1C base with golden #D4A256 highlights).
Accessory: a snapback baseball cap worn at a slight tilt on top of the head, in solid color (e.g., black or red).
Vibe: playful, energetic, sporty — a fun and casual friend.
```

---

## 4. いちごボバ 🍓

**ファイル名**: `ichigo.png`

```
[共通プレフィックス] + 
Character: "Ichigo Boba" — the childlike, food-loving one.
Body color: strawberry pink (#F4A6B8 base with #D14B5E deeper pink shadow).
Accessory: a tiny strawberry leaf stem (green) on top of the head AND small strawberry seed dots (tiny yellow specks) on the cheeks.
Vibe: childlike wonder, sweet, curious, slightly chubby cuteness.
```

---

## 5. コーヒーボバ ☕

**ファイル名**: `coffee.png`

```
[共通プレフィックス] + 
Character: "Coffee Boba" — the cool, intellectual one.
Body color: dark espresso brown (#3D2615 base with cream #E8D5BC subtle highlights).
Accessory: large modern over-ear headphones (matte black or white) covering the ears, OR a pair of dark-framed square eyeglasses.
Vibe: cool, intellectual, a bit aloof — film noir senpai energy.
```

---

## 6. 桜ボバ 🌸

**ファイル名**: `sakura.png`

```
[共通プレフィックス] + 
Character: "Sakura Boba" — the travel-loving older sister.
Body color: soft pale pink (#F8C8D8 base with #FBF6EE cream highlights).
Accessory: a small straw sun hat (麦わら帽) sitting on top AND one or two tiny sakura cherry blossom petals on the cheek.
Vibe: cheerful, frank, well-traveled — like a fun older sister who just came back from Bali.
```

---

## ChatGPT への投げ方（推奨）

1回のチャットで全部生成するのが綺麗（一貫性が出やすい）：

```
これから6つの同じシリーズキャラを順に作ります。
重要: ポーズ・体型・線の太さ・サイズは6体全てで完全に揃えてください。色と装飾だけ変えます。

[以下、1〜6を1個ずつ貼っていく]
```

---

## 生成完了後の配置

```bash
mkdir -p ~/Projects/english-conversation-app/public/characters
```

ダウンロードした6枚を以下の名前で配置:

```
public/characters/
├── milk.png
├── matcha.png
├── kokutou.png
├── ichigo.png
├── coffee.png
└── sakura.png
```

---

## 次のステップ（私の作業）

画像が揃ったら、以下を実装します:

1. **キャラピッカーUI**を更新: 絵文字 → 実画像
2. **メインのBobaキャラ表示**を更新: SVGキャラ → 選択中キャラの画像
3. **landing.html** に6キャラ画像を掲載
4. SVG表情切替（happy/cheer/wow/think/oops/shy/sleep）は当面**画像版では一旦保留**（後で各キャラ×7表情の生成は重い）

→ 表情切替は SVG ベース（現状）のままで、画像はピッカー + LP + ヘッダー等の「静的キャラ表示」に使う構成にすると現実的。

---

## 画像生成のコツ

- ChatGPT で生成 → イマイチなら「もっと丸く」「もっと優しい目で」「線をもう少し細く」と微調整
- 6枚並べて見比べて、明らかに浮いてるキャラがあれば再生成
- 透過処理は必ず確認（背景が白で残ってしまうことがある → 「transparent background, PNG with alpha」を強調）
- 完璧を目指さず、雰囲気が揃ってればOK。後でいつでも差し替え可能
