# tealus-site

[Tealus](https://github.com/gamasenninn/tealus) 公式ランディングページ。
本番: https://tealus.dev

## 構成

静的サイト（ビルド工程なし）。`index.html` + `assets/` をそのまま GitHub Pages が配信する。

```
tealus-site/
├── index.html          # 本体
├── assets/
│   ├── css/style.css   # スタイル
│   └── images/         # ヒーロー画像・ユースケース画像・OG 画像
├── CNAME               # カスタムドメイン (tealus.dev)
└── LICENSE             # MIT
```

## デプロイ

### GitHub Pages

1. リポジトリの **Settings > Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main` / `/ (root)`
2. master に push すれば自動デプロイ。
3. `CNAME` によりカスタムドメイン `tealus.dev` が反映される（DNS は別途設定済み前提）。

### DNS 設定（リファレンス）

Cloudflare 等で `tealus.dev` のレコードを以下に:

```
CNAME  @  gamasenninn.github.io
```

または A レコードで GitHub Pages の IP を指定。詳細は [GitHub Pages のドキュメント](https://docs.github.com/ja/pages/configuring-a-custom-domain-for-your-github-pages-site) 参照。

## ローカル確認

ビルド不要。ブラウザで `index.html` を直接開くか、簡易サーバーで確認:

```bash
# Python
python3 -m http.server 8000

# Node.js (npx)
npx serve .
```

`http://localhost:8000` で表示確認。

## 画像素材について

- `hero-chat.png`, `chat-group.png`: Tealus 本体のデモ環境（`tealus_demo` DB + `seed-demo.js`）で撮影した架空データのスクリーンショット
- `uc-*.png`: ユースケース別イメージ
- `og-image.png`: OG タグ用画像

スクリーンショット更新手順は [tealus 本体リポの seed-demo.js ヘッダー](https://github.com/gamasenninn/tealus/blob/master/server/scripts/seed-demo.js) 参照。

## 関連リポジトリ

- [tealus](https://github.com/gamasenninn/tealus) — 本体（メッセンジャー）
- [tealus-docs](https://github.com/gamasenninn/tealus-docs) — 公式ドキュメント（MkDocs）

## ライセンス

MIT License. See [LICENSE](./LICENSE).
