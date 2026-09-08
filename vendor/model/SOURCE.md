# Bundled model

**`qa-fp16.onnx`** — `distilbert-base-uncased-distilled-squad` exported with
optimum, attention/GELU/LayerNorm fused with `onnxruntime.transformers`, and
converted to fp16 with float32 inputs and outputs. 133 MB. Runs on ONNX Runtime
Web's WebGPU execution provider. Published as a GitHub release asset
(`model-v2`) because nobody hosts this exact build.

**`qa-int8.onnx`** — `Xenova/distilbert-base-uncased-distilled-squad`,
`onnx/model_quantized.onnx`, 67 MB. The WASM fallback for machines without a
GPU adapter. Apache-2.0.

**`vocab.txt`** — the matching bert-base-uncased WordPiece vocabulary (30,522
tokens). Tokenization is implemented in `src/offscreen/wordpiece.js` and checked
against known token ids in `test/wordpiece.test.js`.

## Why this model

A cross-encoder reranker (`ms-marco-MiniLM-L-6-v2`) was tried first and scored
*worse than keyword matching*, ranking content-farm preamble above the passage
that actually answered the question. A reranker measures topical relevance, and
a paragraph restating the query is maximally on-topic. Extractive QA is the
right task: "does this passage contain the answer, and where" is what a
featured snippet is.

SQuAD 2.0 models (`deepset/tinyroberta-squad2`, `deepset/roberta-base-squad2`)
were tried next, expecting their trained "no answer" logit to help. It hurt:
they rank a passage that merely repeats the question above the one that
answers it, and go negative on plain answers ("work began under the Qin
dynasty around 221 BC"). On a 15-query set where the answer shares no words
with the question they scored 8/15 and 9/15 against this model's 15/15.
`csarron/bert-base-uncased-squad-v1` matched it at 15/15 but is twice the size
and half the speed.

## Refreshing it

    ./tools/fetch-model.sh
