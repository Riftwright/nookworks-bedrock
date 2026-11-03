# Nookworks for Bedrock（試作 / prototype）

**日本語** | [English](#english)

> **試作版です。** Java 版 MOD「Nookworks」を、作者本人が統合版（Bedrock）のアドオンに移植したものです。Java 版とは別の、実験的な版です。
> **バグがあります。更新は不定期です。**
> **バグ報告・要望は GitHub の [Issues](../../issues) にのみお願いします。ほかの場所では受け付けません。**

Java 版 Nookworks（NeoForge 26.3）の飾り、台所、収納、工房（発電機・機械・パイプ・ベルト）などを、統合版のアドオンとして移植しています。
統合版でそのままできない部分は、別の形に置き換えています。一覧は [GAPS.md](GAPS.md) にあります（英語。末尾に日本語のまとめがあります）。
例：機械の画面はフォームで出ます。液体は数値で扱います。「イフ」は同じ世界の遠い場所になります。

## 入れ方（Windows 版）
1. [Releases](../../releases) から `Nookworks.mcaddon` をダウンロードして、ダブルクリックします。Minecraft が開いて取り込まれます。
2. ワールドの設定で「ビヘイビアーパック」→ Nookworks を「有効にする」を選びます（リソースパックも一緒に入ります）。
   実験的機能はオフのままで動きます。
3. 対応バージョン：Minecraft 統合版 1.26.60 以降。

## Switch・PS などで遊ぶには
Switch や PS では、アドオンを直接入れられません。Windows 版でアドオン入りのワールドを開き、同じ Wi-Fi から LAN で参加してください。

1. PC：ワールドの「マルチプレイヤー」設定で「マルチプレイヤーゲーム」と「LAN プレイヤーに表示」をオンにして、ワールドに入ったままにします。
2. Switch：「プレイ」→「フレンド」→「LAN ゲーム」に出る PC のワールドを選びます。パックのダウンロードを聞かれたら「ダウンロード」を選びます。
3. 「マルチプレイヤーは無効です」と出る場合は、Switch でサインインしている Microsoft アカウントでマルチプレイが許可されていません。
   - 大人のアカウント：account.xbox.com の「プライバシーとオンライン安全」で許可します。
   - 子どものアカウント：保護者が Xbox Family Settings で許可します。
4. PC と Switch の Minecraft は、同じバージョンにそろえてください。

## ライセンス
MIT（[LICENSE](LICENSE)）。テクスチャは Nookworks 自前のものだけを含みます。バニラの画像は含めず、ゲーム内のパスで参照しています。

## AI について
このアドオンは、作者の指示のもとで AI（Anthropic の Claude）が作っています。

## 自分でビルドする
`../mine_mod` に Java 版 Nookworks（[Riftwright/nookworks](https://github.com/Riftwright/nookworks)）のソースを置いて、次の順に実行します。
1. `python tools/fetch_refs.py`
2. `python tools/convert.py`
3. `python tools/package.py`

必要なもの：Python 3（Pillow）と、ローカルに入っている Java 版と統合版の Minecraft（参照データの読み取りに使います）。

---

<a id="english"></a>
## English

> **Prototype.** A Bedrock port of the Java mod Nookworks by its own author, separate from the Java mod and experimental.
> **Expect bugs. Updates are irregular.**
> **Please report bugs and requests in GitHub [Issues](../../issues) only. Reports anywhere else are not taken.**

This add-on ports Nookworks' decoration, kitchen, storage and workshop to Bedrock: generators, machines, pipes and belts.
Where Bedrock can't do what Java does, something stands in for it. [GAPS.md](GAPS.md) lists every case.
For example, machine screens are forms, liquids are kept as numbers, and "the If" is a far part of the same world.

### Installing (Windows)
1. Download `Nookworks.mcaddon` from [Releases](../../releases) and double-click it. Minecraft opens and imports it.
2. In the world's settings, go to **Behavior Packs** and activate Nookworks. The resource pack comes with it.
   No experiments are needed.
3. Needs Minecraft Bedrock 1.26.60 or later.

### Switch, PlayStation and other consoles
Consoles can't import add-ons. Open the world with the add-on on Windows and join it over LAN from the console.

1. On the PC: in the world's **Multiplayer** settings, turn on **Multiplayer Game** and **Visible to LAN Players**, then stay in the world.
2. On the console: go to **Play → Friends → LAN Games** and pick the PC's world. Accept the pack download if asked.
3. If it says "Multiplayer is disabled", the console's Microsoft account isn't allowed multiplayer.
   - Adult accounts: allow it at account.xbox.com under Privacy & online safety.
   - Child accounts: a parent allows it in Xbox Family Settings.
4. Both copies of Minecraft must be the same version.

### License
MIT ([LICENSE](LICENSE)). Only Nookworks' own textures are included. Vanilla textures are referenced by their in-game paths, never copied.

### About AI
This add-on is made by AI (Claude, by Anthropic) under the author's direction.

### Building it yourself
Put the Java source ([Riftwright/nookworks](https://github.com/Riftwright/nookworks)) at `../mine_mod`, then run:
1. `python tools/fetch_refs.py`
2. `python tools/convert.py`
3. `python tools/package.py`

You need Python 3 with Pillow, plus local installs of Minecraft Java and Bedrock (reference data is read from them).
