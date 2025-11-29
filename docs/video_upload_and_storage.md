# Video Upload & Storage Flow

## 1. フロントエンドからのアップロード
- ユーザーが動画を選択し、`useUploadVideo` フックが GraphQL `uploadVideo` ミューテーションを呼び出す。
- ファイルサイズは 70 MB まで（`MAX_FILE_SIZE_IN_MB`）で、フロントエンド側でチェックされる。

## 2. バックエンドでの処理 (`upload_video` ミューテーション)
1. **一時ファイル作成**: `process_video` が一時ディレクトリに `in.mp4` として保存。
2. **メタデータ取得**: `get_video_metadata` で解像度・長さを取得。
3. **トリミング / トランスコード**
   - `MAX_UPLOAD_VIDEO_DURATION`（デフォルト 10 秒）を超える場合は `start_time_sec` と `duration_time_sec` が自動で設定され、`transcode` が `out.mp4` を生成。
   - `MAX_UPLOAD_VIDEO_DURATION` を環境変数で上書きすればトリミングを無効化できる（例: `MAX_UPLOAD_VIDEO_DjURATION=1000`）。
4. **ハッシュ生成 & 保存**
   - `out.mp4` の SHA‑256 ハッシュを計算し、`{hash}.mp4` という名前で **`/data/uploads`** に移動。
   - `Video` オブジェクトは `filepath`, `file_key`, `width`, `height` を持ち、`generate_poster=False` のためポスターは作成されない。

## 3. ギャラリーディレクトリ (`/data/gallery`)
- `loader.py` の `preload_data` が `GALLERY_PATH`（`/data/gallery`）以下の `*.mp4` を再帰的に走査し、`Video` オブジェクトを作成してメモリに保持。
- **トリミングは行われない**。ギャラリーに置いた動画はそのままの長さで利用できる。
- `GET /videos`（GraphQL `videos` クエリ）で返されるリストはこのディレクトリだけを対象にしている。

## 4. 推論結果の保存 (`SAVE_PREDICTIONS`)
- `SAVE_PREDICTIONS=1` が有効な場合、`predictor.propagate_in_video` の各フレームで
  - `DATA_PATH/predictions/<session_id>/frame_XXXXX.npy` に **raw logits**（`float32`）を保存。
  - 同時に `frame_XXXXX_obj_ids.npy` にオブジェクト ID 配列を保存。
- `DATA_PATH` は環境変数 `DATA_PATH`（デフォルト `/data`）で決まり、Docker では `./demo/data` がマウントされている。

## 5. Docker のボリューム設定
```yaml
services:
  backend:
    volumes:
      - ./demo/data/:/data/:rw   # ← ホスト側の demo/data がコンテナの /data にマッピング
```
- **`/data`** 配下に自動で作成されるディレクトリ:
  - `gallery/`   ← 手動で動画を置く場所（トリミングなし）
  - `uploads/`   ← アップロード後のトリミング/トランスコード済み動画
  - `predictions/`← 推論 logits を保存（`SAVE_PREDICTIONS` が有効なとき）
  - `posters/`   ← 動画サムネイル（ギャラリー動画から自動生成）

## 6. カスタム動画をローカルで利用する手順
1. **ホスト側**で `demo/data/gallery` に MP4 ファイルをコピー（例: `my_video.mp4`）。
2. Docker コンテナを再起動（`docker-compose up -d --build`）すると `preload_data` が自動で検出し、フロントエンドの動画一覧に追加される。
3. 必要に応じて `MAX_UPLOAD_VIDEO_DURATION` を環境変数で上書きし、長い動画でもトリミングせずに処理できる。

---
**ポイント**
- アップロードされた動画は **`/data/uploads`** にハッシュ名で保存され、元のファイルは削除される。
- ギャラリーディレクトリはトリミングされないので、長さ制限は **`MAX_UPLOAD_VIDEO_DURATION`** のみが影響する。
- 推論結果は `DATA_PATH/predictions` 以下に保存され、ボリュームマウントによりホストから直接確認可能。
