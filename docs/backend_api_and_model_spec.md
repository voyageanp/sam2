# Backend API & Model Specification

このドキュメントでは、SAM2デモアプリケーションのバックエンドAPI仕様と、SAM2モデルの入出力データ構造について詳細に説明します。

## 1. Backend API (GraphQL)

バックエンドは `http://localhost:7263/graphql` でGraphQL APIを提供しています。

### Queries

#### `videos`
利用可能なすべてのビデオのリストを取得します。

- **Response**: `[Video]`
  - `path`: ビデオファイルのパス
  - `url`: ビデオのURL
  - `posterPath`: ポスター画像のパス

#### `default_video`
デフォルトのビデオを取得します。

- **Response**: `Video`

### Mutations

#### `startSession`
新しいセッションを開始し、推論のためのリソースを確保します。

- **Input**: `StartSessionInput`
  - `path`: ビデオパス (String!)
- **Response**: `StartSession`
  - `sessionId`: セッションID (String)

#### `addPoints`
ビデオフレームにポイント（クリック）を追加し、そのフレームのマスクを即座に生成します。

- **Input**: `AddPointsInput`
  - `sessionId`: セッションID (String!)
  - `frameIndex`: フレーム番号 (Int!)
  - `objectId`: オブジェクトID (Int!)
  - `points`: 座標リスト `[[x, y], ...]` (Floatの配列の配列!)。座標は0.0〜1.0に正規化されています。
  - `labels`: ラベルリスト `[1, 0, ...]` (Intの配列!)。1=ポジティブ, 0=ネガティブ。
  - `clearOldPoints`: 以前のポイントをクリアするかどうか (Boolean!)
- **Response**: `RLEMaskListOnFrame`
  - `frameIndex`: フレーム番号
  - `rleMaskList`: `[RLEMaskForObject]` (オブジェクトIDとRLEマスクのペア)

#### `removeObject`
特定のオブジェクトを追跡から削除します。

- **Input**: `RemoveObjectInput`
  - `sessionId`: セッションID (String!)
  - `objectId`: オブジェクトID (Int!)
- **Response**: `[RLEMaskListOnFrame]` (影響を受けたフレームの更新されたマスクリスト)

#### `clearPointsInFrame` / `clearPointsInVideo`
ポイントをクリアし、推論状態をリセットします。

- **Input**: `ClearPointsInFrameInput` / `ClearPointsInVideoInput`
- **Response**: `RLEMaskListOnFrame` / `ClearPointsInVideo`

#### `closeSession`
セッションを終了し、リソースを解放します。

- **Input**: `CloseSessionInput`
  - `sessionId`: セッションID (String!)
- **Response**: `CloseSession` (success: Boolean)

---

## 2. Streaming API (HTTP)

ビデオ全体へのマスク伝播（トラッキング）は、HTTPストリーミングを使用します。

- **Endpoint**: `POST /propagate_in_video`
- **Content-Type**: `application/json`
- **Input**:
  ```json
  {
    "session_id": "uuid-string",
    "start_frame_index": 0
  }
  ```
- **Output**: `multipart/x-savi-stream`
  - レスポンスはマルチパート形式でストリーミングされます。
  - 各パートはJSONデータを含みます。
  - **JSON構造**:
    ```json
    {
      "frame_index": 10,
      "results": [
        {
          "object_id": 1,
          "mask": {
            "counts": "...", // RLEエンコードされたマスクデータ
            "size": [height, width]
          }
        }
      ]
    }
    ```

---

## 3. SAM2 Model Input/Output Specification

バックエンド内部で使用される `SAM2VideoPredictor` クラスの入出力仕様です。

### 入力 (Inputs)

#### `add_new_points_or_box`
ユーザーのクリックやボックス選択をモデルに入力します。

- **points**: `torch.Tensor` (float32)
  - Shape: `[N, 2]` または `[1, N, 2]` (バッチ次元あり)
  - 内容: `(x, y)` 座標。`normalize_coords=True` の場合は 0.0〜1.0、そうでない場合はピクセル座標。
- **labels**: `torch.Tensor` (int32)
  - Shape: `[N]` または `[1, N]`
  - 内容: `1` (ポジティブクリック), `0` (ネガティブクリック), `2` (ボックス左上), `3` (ボックス右下)。
- **box**: `torch.Tensor` (float32)
  - Shape: `[2, 2]` または `[1, 2, 2]`
  - 内容: `[[x_min, y_min], [x_max, y_max]]`。
- **frame_idx**: `int` (対象のフレーム番号)
- **obj_id**: `int` (対象のオブジェクトID)

#### `add_new_mask`
既存のマスクを初期入力として与える場合に使用します。

- **mask**: `torch.Tensor` (bool または float32)
  - Shape: `[H, W]`
  - 内容: バイナリマスクまたはロジット。

### 出力 (Outputs)

モデルは通常、以下の形式で予測結果を返します。

#### `add_new_points_or_box` の戻り値
- **frame_idx**: `int`
- **obj_ids**: `List[int]` (現在追跡中の全オブジェクトID)
- **video_res_masks**: `torch.Tensor` (float32)
  - Shape: `[N_obj, 1, Original_H, Original_W]`
  - 内容: **Raw Logits** (シグモイド関数適用前の値)。
  - 注意: マスクとして使用するには、通常 `mask > 0.0` (または `sigmoid(mask) > 0.5`) で閾値処理を行います。

#### `propagate_in_video` (Generator) のYield値
- **frame_idx**: `int`
- **obj_ids**: `List[int]`
- **video_res_masks**: `torch.Tensor` (float32)
  - Shape: `[N_obj, 1, Original_H, Original_W]`
  - 内容: Raw Logits。

### データ構造の詳細

- **Inference State**: モデルは `inference_state` という辞書でセッション全体の状態を管理します。これには画像特徴量、過去のメモリ、入力されたポイントなどが含まれます。
- **Memory Bank**: 過去のフレームの特徴量はメモリバンクに保存され、`Transformer` を介して現在のフレームの推論に利用されます。
