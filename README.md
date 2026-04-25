# PDF 編集アプリ

ブラウザから PDF のページ回転、ページ分割、ページ並べ替え、ページ切り出しを行い、新しい PDF としてダウンロードするアプリケーションです。

## 対応している操作

- ページの 90 度単位の回転
- ページの左右 2 分割、上下 2 分割
- ページ順の変更
- ページの切り出し
- 編集結果の PDF ダウンロード

## 開発環境

- Next.js
- TypeScript
- `pdf-lib`
- `pdfjs-dist`

## ローカル起動

```bash
npm install
npm run dev
```

`http://localhost:3000` を開くと編集画面が表示されます。

## Docker 起動

```bash
docker build -t pdf-editor .
docker run --rm -p 3000:3000 pdf-editor
```

または:

```bash
docker compose up --build
```

## 補足

- PDF のプレビュー表示はブラウザ上で行います
- PDF の最終生成はサーバー側 API で行います
- 切り出しは元ページ基準の上下左右割合で指定します
