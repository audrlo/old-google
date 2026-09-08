#!/usr/bin/env bash
# Fetches the binaries the extension needs but the repo does not carry:
# the question-answering model (fp16 for WebGPU, int8 for the WASM fallback)
# and the ONNX Runtime Web builds.
#
#   ./tools/fetch-model.sh
#
# Without these the extension still works — passage ranking falls back to
# keyword scoring, and the popup toggle for the model does nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HF="https://huggingface.co/Xenova/distilbert-base-uncased-distilled-squad/resolve/main"
RELEASE="https://github.com/audrlo/old-google/releases/download/model-v2"

mkdir -p "$ROOT/vendor/model" "$ROOT/vendor/ort"

echo "Fetching the QA model, fp16 for WebGPU (133 MB)..."
curl -fL --progress-bar -o "$ROOT/vendor/model/qa-fp16.onnx" "$RELEASE/distilbert-squad-fused-fp16.onnx"
echo "Fetching the QA model, int8 for WASM (67 MB)..."
curl -fL --progress-bar -o "$ROOT/vendor/model/qa-int8.onnx" "$HF/onnx/model_quantized.onnx"
curl -fL -s -o "$ROOT/vendor/model/vocab.txt" "$HF/vocab.txt"

echo "Fetching ONNX Runtime Web..."
if [ ! -d "$ROOT/test/node_modules/onnxruntime-web" ]; then
  ( cd "$ROOT/test" && npm install --silent --no-audit --no-fund onnxruntime-web )
fi
DIST="$ROOT/test/node_modules/onnxruntime-web/dist"
cp "$DIST/ort.webgpu.min.js" "$DIST/ort-wasm-simd-threaded.asyncify.mjs" "$DIST/ort-wasm-simd-threaded.asyncify.wasm" \
   "$DIST/ort.wasm.min.js" "$DIST/ort-wasm-simd-threaded.mjs" "$DIST/ort-wasm-simd-threaded.wasm" "$ROOT/vendor/ort/"

echo
echo "Done:"
du -h "$ROOT/vendor/model/qa-fp16.onnx" "$ROOT/vendor/model/qa-int8.onnx" "$ROOT/vendor/ort/"*.wasm | sed 's/^/  /'
