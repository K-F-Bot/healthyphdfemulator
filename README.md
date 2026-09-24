# healthy-phd-student-emulator

博士課程学生が研究室生活で経験したやってよかったこと・失敗談を共有するサイトです。

## ファイル構成

`
PhD_emu_AI/
├── gas_script.js        ← Google Apps Script（バックエンド）
└── public/
    ├── index.html       ← トップページ（最新投稿・タグ検索・いいねランキング）
    ├── post.html        ← 新規投稿フォーム
    ├── edit.html        ← 投稿編集フォーム
    ├── about.html       ← このサイトについて
    ├── style.css        ← スタイルシート
    └── main.js          ← JavaScript（API・投稿表示・いいね・コメント）
`

## セットアップ手順

### 1. Google スプレッドシートの準備

1. Google スプレッドシートを新規作成する
2. 「拡張機能」→「Apps Script」を開く
3. gas_script.js の内容をすべてコピーして貼り付ける
4. 「initSheets」関数を選択して「▶ 実行」ボタンを押す（シートの初期化）
5. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選ぶ
   - 実行ユーザー: 自分
   - アクセス: 全員（匿名含む）
6. デプロイ後に表示される URL をコピーする

### 2. main.js の設定

public/main.js の最初の行のURLを書き換える：

`javascript
const GAS_URL = 'YOUR_GAS_WEB_APP_URL_HERE';
//                ↑ ここに手順1でコピーしたURLを貼り付ける
`

### 3. GitHub Pages で公開

1. public/ フォルダ内のファイルをGitHubリポジトリにプッシュする
2. リポジトリ Settings → Pages → Source を「main ブランチ / public フォルダ」に設定
3. 公開されたURLをメンバーに共有する

## 機能一覧

- 投稿（5W1H + Then + タグ + どうすればよかったか + 備考）
- 最新投稿一覧（カード形式・クリックで展開）
- タグ検索
- いいね（ブラウザ単位で1回まで）
- いいねランキング（上位20件）
- コメント機能
- 投稿編集

## データについて

投稿データは Google Spreadsheet に保存されます。
- posts シート：投稿データ（1行1投稿）
- comments シート：コメントデータ

スプレッドシートはExcelでダウンロードでき、RAG学習データとしても活用できます。
