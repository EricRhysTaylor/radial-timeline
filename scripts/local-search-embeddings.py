#!/usr/bin/env python3
"""Loopback-only, offline BGE passage embeddings for the Radial Timeline index.

No note text, queries or vectors are logged. Model download is an explicit setup
step; starting the service only reads pinned files already in the local cache.
"""
import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from tokenizers import Tokenizer

MODEL = 'BAAI/bge-small-en-v1.5'
REVISION = '5c38ec7c405ec4b44b94cc5a9bb96e735b38267a'
DIMENSIONS = 384
QUERY_PROMPT = 'Represent this sentence for searching relevant passages: '
MAX_TOKENS = 512
PASSAGE_TOKENS = 440
OVERLAP_TOKENS = 64
MAX_BYTES = 16 * 1024 * 1024
IDENTITY = f'{MODEL}@{REVISION}:cls:passage{PASSAGE_TOKENS}:overlap{OVERLAP_TOKENS}:v1'


def model_files(download=False):
    return [hf_hub_download(MODEL, filename, revision=REVISION, local_files_only=not download)
            for filename in ('tokenizer.json', 'onnx/model.onnx')]


class Encoder:
    def __init__(self):
        tokenizer_path, model_path = model_files()
        self.tokenizer = Tokenizer.from_file(tokenizer_path)
        self.tokenizer.no_truncation()
        self.tokenizer.enable_padding(pad_id=0, pad_token='[PAD]')
        config = ort.SessionOptions()
        config.intra_op_num_threads = 4
        config.inter_op_num_threads = 1
        self.model = ort.InferenceSession(model_path, sess_options=config, providers=['CPUExecutionProvider'])
        self.inputs = {item.name for item in self.model.get_inputs()}
        self.lock = threading.Lock()

    def passages(self, text):
        encoded = self.tokenizer.encode(text, add_special_tokens=False)
        offsets = encoded.offsets
        if not offsets:
            return []
        result = []
        start = 0
        while start < len(offsets):
            end = min(start + PASSAGE_TOKENS, len(offsets))
            passage = text[offsets[start][0]:offsets[end - 1][1]]
            if len(self.tokenizer.encode(passage).ids) > MAX_TOKENS:
                raise ValueError('Passage token budget exceeded; no input was truncated.')
            result.append(passage)
            if end == len(offsets):
                break
            start = end - OVERLAP_TOKENS
        return result

    def vectors(self, texts):
        result = []
        for start in range(0, len(texts), 16):
            tokens = self.tokenizer.encode_batch(texts[start:start + 16])
            if any(len(item.ids) > MAX_TOKENS for item in tokens):
                raise ValueError('Embedding input exceeds 512 tokens; no input was truncated.')
            values = {'input_ids': [item.ids for item in tokens],
                      'attention_mask': [item.attention_mask for item in tokens],
                      'token_type_ids': [item.type_ids for item in tokens]}
            outputs = self.model.run(None, {key: np.array(value, dtype=np.int64)
                                           for key, value in values.items() if key in self.inputs})
            hidden = outputs[0]
            if hidden.ndim != 3 or hidden.shape[2] != DIMENSIONS:
                raise ValueError('Unexpected embedding model output dimensions.')
            vectors = hidden[:, 0, :]
            norms = np.linalg.norm(vectors, axis=1, keepdims=True)
            if not np.all(np.isfinite(vectors)) or np.any(norms <= 0):
                raise ValueError('Embedding model returned invalid vectors.')
            result.extend((vectors / norms).tolist())
        return result

    def encode(self, texts, kind):
        with self.lock:
            if kind == 'query':
                inputs = [QUERY_PROMPT + text for text in texts]
                return [[{'text': original, 'vector': vector}]
                        for original, vector in zip(texts, self.vectors(inputs))]
            groups = [self.passages(text) for text in texts]
            flattened = [text for group in groups for text in group]
            vectors = iter(self.vectors(flattened))
            return [[{'text': text, 'vector': next(vectors)} for text in group] for group in groups]


def serve(port):
    encoder = Encoder()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, body):
            raw = json.dumps(body, allow_nan=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path != '/v1/index-model':
                self.reply(404, {'error': 'Unknown endpoint'})
                return
            self.reply(200, {'schemaVersion': 1, 'identity': IDENTITY, 'model': MODEL,
                             'dimensions': DIMENSIONS, 'maxTokens': MAX_TOKENS, 'language': 'en'})

        def do_POST(self):
            if self.path != '/v1/search-embeddings':
                self.reply(404, {'error': 'Unknown endpoint'})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size <= 0 or size > MAX_BYTES:
                    raise ValueError('Invalid embedding request size')
                body = json.loads(self.rfile.read(size))
                texts, kind = body.get('texts'), body.get('kind')
                if kind not in ('query', 'document') or not isinstance(texts, list) or not 1 <= len(texts) <= 32:
                    raise ValueError('Expected query/document kind and 1 to 32 texts')
                if any(not isinstance(text, str) or not text.strip() or len(text) > 2_000_000 for text in texts):
                    raise ValueError('Embedding texts must be nonempty strings within the size limit')
                self.reply(200, {'schemaVersion': 1, 'identity': IDENTITY, 'documents': encoder.encode(texts, kind)})
            except (ValueError, json.JSONDecodeError) as error:
                self.reply(400, {'error': str(error)})
            except (BrokenPipeError, ConnectionResetError):
                pass  # Client cancellation never logs or resubmits manuscript input.
            except Exception:
                self.reply(500, {'error': 'Local embedding execution failed; inspect the runtime, not manuscript logs.'})

    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    print(f'Local search encoder ready: {IDENTITY} on 127.0.0.1:{port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--port', type=int, default=8081)
    args = parser.parse_args()
    if args.download:
        model_files(download=True)
        print(f'Cached pinned index model {MODEL}@{REVISION}')
    else:
        serve(args.port)
