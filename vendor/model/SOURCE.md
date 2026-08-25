# Bundled model

**`qa.onnx`** — `Xenova/distilbert-base-uncased-distilled-squad`, ONNX int8
(`onnx/model_quantized.onnx`), 63 MB. Apache-2.0. DistilBERT fine-tuned on
SQuAD for extractive question answering.

**`vocab.txt`** — the matching bert-base-uncased WordPiece vocabulary (30,522
tokens). Tokenization is implemented in `src/offscreen/wordpiece.js` and checked
against known token ids in `test/wordpiece.test.js`.

## Why this model and not a reranker

A cross-encoder reranker (`ms-marco-MiniLM-L-6-v2`) was tried first and scored
*worse than keyword matching* — 1/3 on a small benchmark, ranking content-farm
preamble above the passage that actually answered the question. That was not a
quantization artifact: fp32 gave the same scores. A reranker measures topical
relevance, and a paragraph restating the query is maximally on-topic.

Extractive QA is the right task: "does this passage contain the answer, and
where" is what a featured snippet is. On the same benchmark it scores 9/10
against keyword scoring's 7/10, winning precisely the cases where query and
answer share no words ("what do gazelles eat" -> "their diet consists of...").

## Refreshing it

    curl -L -o vendor/model/qa.onnx \
      https://huggingface.co/Xenova/distilbert-base-uncased-distilled-squad/resolve/main/onnx/model_quantized.onnx
    curl -L -o vendor/model/vocab.txt \
      https://huggingface.co/Xenova/distilbert-base-uncased-distilled-squad/resolve/main/vocab.txt
