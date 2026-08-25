#!/usr/bin/env bash
# Fetches the binaries the extension needs but the repo does not carry:
# the question-answering model and the ONNX Runtime WASM build.
#
#   ./tools/fetch-model.sh
#
# Without these the extension still works — passage ranking falls back to
# keyword scoring, and the popup toggle for the model does nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HF="https://huggingface.co/Xenova/distilbert-base-uncased-distilled-squad/resolve/main"

mkdir -p "$ROOT/vendor/model" "$ROOT/vendor/ort"

echo "Fetching the QA model (63 MB)..."
curl -fL --progress-bar -o "$ROOT/vendor/model/qa.onnx" "$HF/onnx/model_quantized.onnx"
curl -fL -s -o "$ROOT/vendor/model/vocab.txt" "$HF/vocab.txt"

echo "Fetching ONNX Runtime (WASM)..."
if [ ! -d "$ROOT/test/node_modules/onnxruntime-web" ]; then
  ( cd "$ROOT/test" && npm install --silent --no-audit --no-fund onnxruntime-web )
fi
DIST="$ROOT/test/node_modules/onnxruntime-web/dist"
cp "$DIST/ort.wasm.min.js" "$DIST/ort-wasm-simd-threaded.wasm" "$DIST/ort-wasm-simd-threaded.mjs" "$ROOT/vendor/ort/"

echo
echo "Done:"
du -h "$ROOT/vendor/model/qa.onnx" "$ROOT/vendor/ort/ort-wasm-simd-threaded.wasm" | sed 's/^/  /'
