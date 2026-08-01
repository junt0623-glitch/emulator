# CLAUDE.md — カートリッジ棚（cart-shelf-emulator）

このリポジトリは、NES/SFCのROMをブラウザで動かす単一ページアプリ。
GitHub Pages で公開し、iPad/Mac のブラウザから使う。**ローカル環境へのソフトインストールは禁止**のため、Claude Code は必ずクラウド版（`claude.ai/code`）で運用する前提。

## ファイル構成
- `index.html` — アプリ本体。UI・ROM選択・EmulatorJS初期化・セーブ管理まで全部ここ
- `sw.js` — オフライン用 Service Worker。**同一オリジンの独立ファイルである必要があるため、index.html には統合できない**（唯一の単一HTML原則の例外）
- `README.md` — セットアップ手順

## アーキテクチャ上の決定事項
- **単一HTML・外部依存ゼロ・ローカルインストール不要・オフライン対応**が全プロジェクト共通の絶対ルール（sw.jsのみ例外）
- エミュレーション本体は自作せず [EmulatorJS](https://emulatorjs.org)（RetroArch WASM）をCDN経由で使用。`EJS_CDN = "https://cdn.emulatorjs.org/stable/data/"`
- ROMは IndexedDB（`cart-shelf` DB, `kv`/`states` ストア）に保存
- **CDNから来たものは Service Worker で全部キャッシュする（コア本体 `/cores/` も含む）**。かつては「コアは EmulatorJS 自身が IndexedDB に保存するので二重に持たない」としていたが、それだとオフライン可否が EmulatorJS 内部のキャッシュ実装に依存し、**実際にオフラインで起動しなかった**（ブラウザのHTTPキャッシュが効いている間だけ動くので、検証時に見逃しやすい）。容量よりオフラインの確実性を優先する
- **ROM切替は必ず `location.reload()` を伴うページ再読込方式**。コアの取り違えを防ぐため、SPA的な差し替えはしない
- **タッチ操作は EmulatorJS 内蔵の仮想パッドを使わず、自前パッド（`.pad-side` / `#dpad` / `.face`）を使う**。内蔵パッドはゲーム画面に重なって絵が隠れるため。自前パッドは画面の外側（縦持ち＝下、横持ち＝左右）に置き、`body.pad-on` のときは内蔵パッドをCSSで非表示にしている
- ROMファイルは `Blob` ではなく **`File` オブジェクト**でEmulatorJSに渡すこと（`new File([buf], name, {...})`）。Blob URLは拡張子情報を失い、拡張子で機種判定するコア（過去にGBA/NDSで発生）が動かなくなる

## 対応機種
現在は **NES（.nes/.fds）と SFC（.smc/.sfc）のみ**。
GBA/NDSは一度実装したが、施設のセキュリティソフト（ウイルスバスター for Mac）が特定のファイル形式のアップロードを静かにブロックする事例が確認され、切り分けが長期化したため撤去した。再度対応する場合はこの制約を前提に検証すること。

## 既知の落とし穴（再発防止）
1. **iOS Safariで `<input type="file" accept="...">` に独自拡張子（.nes等）を指定すると、ファイルがグレーアウトして選択不可になることがある**。`accept` 属性は付けず、選択後にJS側（`sysOf()`）で拡張子を検証する方式にしてある。この属性を安易に復活させないこと
2. **EmulatorJSが内部生成する `.ejs_start_button` に、opacity:0の内部オーバーレイ（`.ejs_context_menu` 等）が重なり、実機タップが届かないことがある**（コンソールから `.click()` すると通ってしまうが、これは「本物のユーザー操作」と見なされずAudioContext等の権限エラーになるので偽陽性の確認方法にはならない）。対策として `#tapStart` という自前の全面オーバーレイボタンを `#screenWrap` 内に設置し、実タップを確実に拾って内部ボタンへ `.click()` で中継している。これを消さないこと
3. **Service Workerはキャッシュを持つため、index.html / sw.js のどちらかを更新したら、`sw.js` 冒頭の `SHELL` の版数（`shell-v10` など）を必ず1つ上げること**。上げ忘れると古いキャッシュが配信され続け、ユーザー側は「アップロードしたのに反映されない」状態になる
   - **`FRAME`（EmulatorJS本体のキャッシュ）の名前は絶対に変えないこと。** `activate` は現行の `SHELL`/`FRAME` 以外のキャッシュを全削除するので、`FRAME` を上げると EmulatorJS 本体（`emulator.min.js` 等）のキャッシュが消え、**「オンラインで一度起動したのにオフラインで起動しない」**状態になる。実際にこれで壊した（v6→v9 で3回消えた）。CDNのURLは `/stable/` 配下で固定なので版数は不要
   - 旧 `ejs-frame-vN` から固定名へ中身を引き継ぐ `adoptOldFrames()` が入っているが、これは移行用なので新たに版数を付ける口実にしないこと
4. **自前パッドの入力は `EJS_emulator.gameManager.simulateInput(0, ボタン番号, 0/1)` で送っている**。番号はlibretroのRetroPad順（`0:B 1:Y 2:SELECT 3:START 4:上 5:下 6:左 7:右 8:A 9:X 10:L 11:R`）で、EmulatorJS側の内部APIなので更新で壊れうる。壊れたときのために `keyCode` 付きの KeyboardEvent を送る保険（`KEYCODE`）を残してある
5. **パッドの当たり判定は要素の `getBoundingClientRect()` をキャッシュして座標で行う**（十字キーの斜め入力・同時押し・指を滑らせての持ち替えのため）。回転／全画面切替／指を全部離したタイミングで採寸し直しているので、レイアウトを変えたら `padMeasure()` が呼ばれる経路も確認すること
6. デバッグ時、ブラウザの通常キャッシュクリアだけではService Workerのキャッシュは消えない。DevTools の Application → Service Workers → Unregister、または Storage → Clear site data が必要

## 開発フロー
1. `index.html` / `sw.js` を編集
2. `sw.js` のバージョン番号（SHELL/FRAME）を上げる
3. `node --check` で構文確認（script内容を抽出して確認する運用）
4. GitHub Pages にpush → 動作確認は実機（iPad Safari / Mac Chrome）で行う。特にiOS Safariでの実機タップ挙動は開発機（Mac）だけでは再現できないことが多い

## テスト環境の制約
- ユーザーはmacOSのローカル開発環境を持たず、GitHubのWeb UIでファイルをアップロードして公開している
- コード変更のたびに「GitHubにアップロード → Service Workerのキャッシュ更新 → 実機で再テスト」のサイクルが発生する。変更は一度にまとめて、テスト往復を最小化することが望ましい
