# SAM2モデルの推論結果（Raw Logits）を保存する方法

現在、`propagate_in_video` で生成される `video_res_masks`（Raw Logits）は、フロントエンドにストリーミングされるだけで、サーバーサイドには保存されていません。

これらを保存するには、`demo/backend/server/inference/predictor.py` を以下のように修正する必要があります。

## 修正対象ファイル

`demo/backend/server/inference/predictor.py`

## 修正内容

`InferenceAPI` クラスの `propagate_in_video` メソッド内で、生成されたマスクをリストに蓄積し、処理終了後に `numpy.save` または `torch.save` を使用してファイルに書き出します。

### コード変更例

```python
# 必要なインポートを追加
import numpy as np
import os
from app_conf import DATA_PATH  # 保存先ディレクトリの定義

# ... (InferenceAPIクラス内)

    def propagate_in_video(
        self, request: PropagateInVideoRequest
    ) -> Generator[PropagateDataResponse, None, None]:
        session_id = request.session_id
        start_frame_idx = request.start_frame_index
        propagation_direction = "both"
        max_frame_num_to_track = None

        # 保存用ディレクトリの作成
        save_dir = DATA_PATH / "predictions" / session_id
        os.makedirs(save_dir, exist_ok=True)

        # 全フレームのマスクを保持するリスト（メモリ使用量に注意）
        # または、フレームごとに個別に保存することも可能です。
        # ここではフレームごとに保存する例を示します。

        with self.autocast_context(), self.inference_lock:
            # ... (ログ出力やセッション取得のコード) ...

            try:
                # ... (セッション状態の取得) ...

                # 順方向 (Forward)
                if propagation_direction in ["both", "forward"]:
                    for outputs in self.predictor.propagate_in_video(
                        inference_state=inference_state,
                        start_frame_idx=start_frame_idx,
                        max_frame_num_to_track=max_frame_num_to_track,
                        reverse=False,
                    ):
                        if session["canceled"]:
                            return None

                        frame_idx, obj_ids, video_res_masks = outputs
                        
                        # --- 【追加】 保存ロジック ---
                        # video_res_masks は [N_obj, 1, H, W] の torch.Tensor (float32, Raw Logits)
                        # CPUに移動してnumpy配列に変換
                        masks_np = video_res_masks.cpu().numpy()
                        
                        # ファイル名: frame_{index}.npy
                        save_path = save_dir / f"frame_{frame_idx:05d}.npy"
                        np.save(save_path, masks_np)
                        
                        # メタデータ（オブジェクトID）も保存しておくと便利です
                        np.save(save_dir / f"frame_{frame_idx:05d}_obj_ids.npy", np.array(obj_ids))
                        # ---------------------------

                        masks_binary = (
                            (video_res_masks > self.score_thresh)[:, 0].cpu().numpy()
                        )
                        
                        # ... (以降の処理は変更なし) ...
                        yield PropagateDataResponse(...)

                # 逆方向 (Backward)
                if propagation_direction in ["both", "backward"]:
                    for outputs in self.predictor.propagate_in_video(
                        # ... (引数は同じ) ...
                        reverse=True,
                    ):
                        # ... (同様の処理) ...
                        
                        frame_idx, obj_ids, video_res_masks = outputs

                        # --- 【追加】 保存ロジック (Forwardと同じ) ---
                        masks_np = video_res_masks.cpu().numpy()
                        save_path = save_dir / f"frame_{frame_idx:05d}.npy"
                        np.save(save_path, masks_np)
                        np.save(save_dir / f"frame_{frame_idx:05d}_obj_ids.npy", np.array(obj_ids))
                        # -----------------------------------------

                        # ... (以降の処理は変更なし) ...
                        yield PropagateDataResponse(...)

            finally:
                logger.info(...)
```

## 保存データの仕様

- **保存場所**: `/data/predictions/<session_id>/` (コンテナ内パス)
- **ファイル形式**: `.npy` (NumPyバイナリ)
- **データ構造**:
    - `frame_XXXXX.npy`: Shape `[N_obj, 1, H, W]` の `float32` 配列。モデルが出力した生のロジット値。
    - `frame_XXXXX_obj_ids.npy`: Shape `[N_obj]` の `int` 配列。各マスクに対応するオブジェクトID。

## 注意点

1.  **ディスク容量**: Raw Logitsは浮動小数点数であり、ビデオの解像度とフレーム数によってはサイズが大きくなります。ストレージ容量に注意してください。
2.  **パフォーマンス**: ディスクI/Oが発生するため、推論速度（FPS）が若干低下する可能性があります。
3.  **非同期書き込み**: パフォーマンスへの影響を最小限に抑えるため、`threading.Thread` などを使って別スレッドで保存処理を行うことも検討してください。
