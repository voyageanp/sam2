# フロントエンド・バックエンド相互作用分析 (http://localhost:7262)

このドキュメントでは、SAM2デモアプリケーションにおけるフロントエンド（React）とバックエンド（Flask/Python）間の相互作用について詳しく説明します。

## 概要

-   **フロントエンド**: ポート `7262` で動作するReactアプリケーション。ほとんどの操作にGraphQLを使用し、ビデオの伝播（propagation）には直接HTTPストリーミングを使用します。
-   **バックエンド**: ポート `7263`（内部的には `5000` にマッピング）で動作するFlaskアプリケーション。GraphQLエンドポイント（`/graphql`）とストリーミングエンドポイント（`/propagate_in_video`）を公開しています。
-   **通信**:
    -   **GraphQL**: セッション管理、ポイント操作、ビデオメタデータに使用されます。
    -   **マルチパートストリーミング**: リアルタイムのビデオマスク伝播に使用されます。
    -   **静的ファイル**: ビデオファイルやポスター画像の配信に使用されます。

---

## 詳細な操作

### 1. ページの読み込み / ビデオ一覧

**フロントエンドのアクション**: ユーザーがアプリケーションを開きます。サイドバーに利用可能なビデオが一覧表示されます。

-   **API呼び出し**: GraphQL Query `videos`
-   **エンドポイント**: `/graphql` (POST)
-   **ペイロード**:
    ```graphql
    query {
      videos {
        path
        posterPath
        url
        # ... その他のメタデータ
      }
    }
    ```
-   **バックエンド処理**:
    -   **リゾルバ**: `demo/backend/server/data/schema.py` 内の `Query.videos`。
    -   **ロジック**: `get_videos()` を呼び出して、設定されたデータディレクトリからビデオファイルをリストアップします。
    -   **レスポンス**: パスとURLを含む `Video` オブジェクトのリスト。

### 2. セッション開始

**フロントエンドのアクション**: ユーザーが注釈を付けるビデオを選択します。

-   **API呼び出し**: GraphQL Mutation `startSession`
-   **エンドポイント**: `/graphql` (POST)
-   **ペイロード**:
    ```graphql
    mutation StartSession($input: StartSessionInput!) {
      startSession(input: $input) {
        sessionId
      }
    }
    ```
    -   `input.path`: 選択されたビデオへのパス。
-   **バックエンド処理**:
    -   **リゾルバ**: `demo/backend/server/data/schema.py` 内の `Mutation.start_session`。
    -   **ロジック**:
        1.  `inference_api.start_session` を呼び出します。
        2.  一意の `session_id` を生成します。
        3.  ビデオの `SAM2VideoPredictor` 状態を初期化します。
        4.  MPS（Mac）を使用している場合、メモリの断片化を避けるためにビデオをCPUにオフロードします。
    -   **レスポンス**: `sessionId` (UUID)。

### 3. ポイントの追加 / 更新（ビデオ上のクリック）

**フロントエンドのアクション**: ユーザーがビデオをクリックして、ポジティブまたはネガティブなポイントを追加します。

-   **API呼び出し**: GraphQL Mutation `addPoints`
-   **エンドポイント**: `/graphql` (POST)
-   **ペイロード**:
    ```graphql
    mutation AddPoints($input: AddPointsInput!) {
      addPoints(input: $input) {
        frameIndex
        rleMaskList { ... }
      }
    }
    ```
    -   `input.sessionId`: 現在のセッションID。
    -   `input.frameIndex`: 現在のフレーム番号。
    -   `input.objectId`: 追跡されているオブジェクトのID。
    -   `input.points`: 正規化された座標 `[x, y]` のリスト。
    -   `input.labels`: ラベルのリスト（ポジティブなら1、ネガティブなら0）。
-   **バックエンド処理**:
    -   **リゾルバ**: `Mutation.add_points`。
    -   **ロジック**:
        1.  `inference_api.add_points` を呼び出します。
        2.  セッション状態を取得します。
        3.  `predictor.add_new_points_or_box` を呼び出してモデルを更新します。
        4.  現在のフレームのマスクを生成します。
        5.  マスクをRLE（Run-Length Encoding）にエンコードします。
    -   **レスポンス**: 現在のフレーム用に生成されたマスクを含む `rleMaskList`。

### 4. オブジェクトの削除

**フロントエンドのアクション**: ユーザーが追跡中のオブジェクトを削除します。

-   **API呼び出し**: GraphQL Mutation `removeObject`
-   **エンドポイント**: `/graphql` (POST)
-   **ペイロード**:
    ```graphql
    mutation RemoveObject($input: RemoveObjectInput!) {
      removeObject(input: $input) { ... }
    }
    ```
-   **バックエンド処理**:
    -   **リゾルバ**: `Mutation.remove_object`。
    -   **ロジック**:
        1.  `inference_api.remove_object` を呼び出します。
        2.  追跡状態からオブジェクトIDを削除します。
        3.  必要に応じてフレームを再評価します。
    -   **レスポンス**: 影響を受けるフレームの更新されたマスク。

### 5. ポイントのクリア（フレーム / ビデオ）

**フロントエンドのアクション**: ユーザーが現在のフレームのポイントをクリアするか、ビデオ全体をリセットします。

-   **API呼び出し**: GraphQL Mutation `clearPointsInFrame` または `clearPointsInVideo`
-   **エンドポイント**: `/graphql` (POST)
-   **バックエンド処理**:
    -   **ロジック**: 対応する `inference_api` メソッドを呼び出して、予測器の状態にあるプロンプトをリセットします。

### 6. 伝播（ビデオ全体での追跡）

**フロントエンドのアクション**: ユーザーがビデオを再生するか、インタラクション後にシステムが自動的にマスクを伝播させます。

-   **API呼び出し**: 直接HTTPストリーミング (Fetch)
-   **エンドポイント**: `/propagate_in_video` (POST)
-   **ペイロード**:
    ```json
    {
      "session_id": "...",
      "start_frame_index": 0
    }
    ```
-   **バックエンド処理**:
    -   **ハンドラ**: `demo/backend/server/app.py` 内の `propagate_in_video`。
    -   **ロジック**:
        1.  `inference_api.propagate_in_video` を呼び出します。
        2.  ビデオフレームを（順方向および逆方向に）反復処理します。
        3.  推論のために `predictor.propagate_in_video` を呼び出します。
        4.  **ストリーミングレスポンス**: マルチパートチャンク（`multipart/x-savi-stream`）を生成（yield）します。各チャンクには、処理されたフレームのJSONエンコードされたRLEマスクが含まれます。
-   **フロントエンドの処理**:
    -   `SAM2Model.ts` が `multipartStream` を使用してストリームを読み取ります。
    -   RLEマスクをデコードし、UIをリアルタイムで更新します。

### 7. セッション終了

**フロントエンドのアクション**: ユーザーがページを離れるか、別のビデオを選択します。

-   **API呼び出し**: GraphQL Mutation `closeSession`
-   **エンドポイント**: `/graphql` (POST)
-   **バックエンド処理**:
    -   **リゾルバ**: `Mutation.close_session`。
    -   **ロジック**:
        1.  `inference_api.close_session` を呼び出します。
        2.  リソースを解放するためにメモリからセッション状態を削除します。

### 8. ビデオのアップロード

**フロントエンドのアクション**: ユーザーがカスタムビデオをアップロードします。

-   **API呼び出し**: GraphQL Mutation `uploadVideo`
-   **エンドポイント**: `/graphql` (POST) - マルチパートアップロード
-   **バックエンド処理**:
    -   **リゾルバ**: `Mutation.upload_video`。
    -   **ロジック**:
        1.  ファイルを一時的な場所に保存します。
        2.  ビデオのメタデータ（ストリーム、寸法、期間）を検証します。
        3.  **トランスコーディング**: 一貫したフォーマット、解像度、FPSを確保するために `ffmpeg` を使用してビデオをトランスコードします。
        4.  処理されたビデオをアップロードディレクトリに移動します。
    -   **レスポンス**: 新しい `Video` オブジェクト。

### 9. 静的リソース

-   **ギャラリービデオ**: `GET /gallery/<path>` -> `GALLERY_PATH` から配信。
-   **ポスター**: `GET /posters/<path>` -> `POSTERS_PATH` から配信。
-   **アップロード**: `GET /uploads/<path>` -> `UPLOADS_PATH` から配信。

---

## バックエンド推論ロジック詳細 (Deep Dive)

`propagate_in_video` エンドポイントが呼び出された際の、内部的なモデル推論プロセス（`SAM2VideoPredictor`）の詳細です。

### 処理フロー

1.  **前処理 (`propagate_in_video_preflight`)**:
    *   ユーザーがクリックしたフレーム（Conditioning Frames）の情報を整理します。
    *   これらのフレームに対して **メモリエンコーダ** を実行し、その特徴量を「メモリバンク」に保存します。これにより、モデルはユーザーの入力を記憶します。

2.  **フレーム反復処理**:
    *   指定された開始フレームから、順方向（Forward）および逆方向（Backward）にビデオフレームを1つずつ処理します。

3.  **単一フレーム推論 (`_run_single_frame_inference`)**:
    各フレームに対して以下のステップが実行されます：

    *   **画像特徴抽出 (`forward_image`)**:
        *   現在のフレーム画像を **画像エンコーダ（Image Encoder / Backbone）** に通し、画像特徴量（Image Features）を抽出します。これは高負荷な処理ですが、キャッシュされる場合があります。

    *   **メモリアテンション (`_prepare_memory_conditioned_features`)**:
        *   **メモリバンク** から、過去のフレーム（ユーザーが操作したフレームや、直近の処理済みフレーム）の特徴量を取得します。
        *   **Transformer** を使用して、現在の画像特徴量と過去のメモリ特徴量を融合（Cross-Attention）させます。これにより、モデルは「過去にどこにオブジェクトがあったか」という情報を現在のフレームに適用します。

    *   **マスクデコード (`_forward_sam_heads`)**:
        *   融合された特徴量を **マスクデコーダ（Mask Decoder）** に入力します。
        *   SAM（Segment Anything Model）と同様のプロンプトエンコーダとマスクデコーダを使用して、現在のフレームにおけるオブジェクトのセグメンテーションマスクを予測します。

    *   **メモリエンコード (`_encode_new_memory`)**:
        *   予測されたマスクと画像特徴量を **メモリエンコーダ（Memory Encoder）** に通します。
        *   この結果は新しい「メモリ」としてメモリバンクに追加され、将来のフレーム（順方向の場合）の推論に使用されます。

4.  **結果の出力**:
    *   生成されたマスクは元のビデオ解像度にリサイズされ、RLEエンコードされてフロントエンドにストリーミングされます。

---

## ビデオエフェクト処理

アプリケーションは、バックエンドによって生成されたセグメンテーションマスクを使用して、リアルタイムでビデオに視覚効果を適用します。

### 処理場所
-   **クライアントサイド（フロントエンド）**: すべての視覚効果はブラウザ内でレンダリングされます。
-   **技術**: **WebGL** (Web Graphics Library)。

### 実装の詳細

1.  **マスクの受信**:
    -   フロントエンドは、`/propagate_in_video` ストリームまたはGraphQLミューテーションを介して、バックエンドからRLEエンコードされたマスクを受信します。
    -   これらのマスクはビットマップにデコードされます。

2.  **WebGLレンダリング**:
    -   **エフェクトクラス**: `demo/frontend/src/common/components/video/effects/` に配置されています。
        -   例: `ReplaceGLEffect.ts`（絵文字置換用）、`BackgroundBlurEffect.ts`、`PixelateEffect.ts`。
    -   **シェーダー**: `demo/frontend/src/common/components/video/effects/shaders/` に配置されています。
        -   フラグメントシェーダー（`.frag`）は、各エフェクトのピクセルレベルのロジックを定義します。

3.  **レンダリングパイプライン**:
    -   ビデオフレームがテクスチャとしてロードされます。
    -   デコードされたマスクは個別のテクスチャ（例：`uMaskTexture0`、`uMaskTexture1`）としてロードされます。
    -   **頂点シェーダー** (`DefaultVert.vert`): ジオメトリ（通常はビデオ領域を覆う単純な四角形）を処理します。
    -   **フラグメントシェーダー**:
        -   マスクテクスチャをサンプリングして、ピクセルが追跡対象オブジェクトに属しているかどうかを判断します。
        -   マスク内の場合、エフェクトを適用します（例：ピクセルを絵文字の色に置き換える、ぼかす、色を変更するなど）。
        -   マスク外の場合、元のビデオピクセルをレンダリングします（背景エフェクトの場合はその逆）。

### 例：絵文字置換 (`ReplaceGLEffect`)
1.  **セットアップ**: 絵文字画像（怒り、ハート、口笛）をテクスチャとしてロードします。
2.  **ユニフォーム**: マスクの数（`uNumMasks`）とマスクテクスチャをシェーダーに渡します。
3.  **シェーダーロジック (`Replace.frag`)**:
    -   現在のピクセル座標でマスク値を確認します。
    -   ピクセルがマスク内にある場合（`maskValue > 0`）、オブジェクトのバウンディングボックス（`bbox`）に基づいて絵文字テクスチャ上の対応する座標を計算します。
    -   ビデオピクセルの色の代わりに絵文字ピクセルの色を出力します。

---

## 主要ファイルの概要

-   **フロントエンド**:
    -   `src/common/tracker/SAM2Model.ts`: セッション管理とストリーミングのメインロジック。
    -   `src/graphql/fetchGraphQL.ts`: GraphQLフェッチャー。
    -   `src/common/components/video/editor/DemoVideoEditor.tsx`: メインエディターコンポーネント。
    -   `src/common/components/video/effects/`: WebGLエフェクトの実装。
    -   `src/common/components/video/effects/shaders/`: エフェクト用のGLSLシェーダー。

-   **バックエンド**:
    -   `server/app.py`: Flaskアプリ、ルート、ストリーミングハンドラ。
    -   `server/data/schema.py`: GraphQLスキーマとリゾルバ。
    -   `server/inference/predictor.py`: SAM2モデルへのインターフェース（`InferenceAPI`）。
    -   `sam2/sam2_video_predictor.py`: ビデオ予測のコアロジック。
    -   `sam2/modeling/sam2_base.py`: モデルアーキテクチャ（エンコーダ、デコーダ、アテンション）。
