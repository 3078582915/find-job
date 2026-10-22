"""Local model transport stub. Real Agent tools and persistence still execute."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class ModelStub:
    def __init__(self):
        self.calls = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                if self.path != '/v1/chat/completions':
                    self.send_error(404)
                    return
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.calls.append(body)
                messages = body.get('messages', [])
                user = next((m.get('content', '') for m in reversed(messages)
                             if m['role'] == 'user'), '')
                if '[test:error]' in str(user):
                    payload = json.dumps({'error': {'message': 'Invalid API key (local test)',
                                                   'type': 'authentication_error'}}).encode()
                    self.send_response(401)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(payload)
                    return
                tool = None
                if messages and messages[-1]['role'] != 'tool':
                    for marker, name, args in [
                        ('[test:search]', 'search_jobs', {'keyword': 'React', 'city': '北京'}),
                        ('[test:stats]', 'get_job_statistics', {}),
                        ('[test:crawl]', 'prepare_job_crawl',
                         {'platform': 'boss', 'query': 'React', 'city': '北京', 'pages': 1}),
                    ]:
                        if marker in str(user):
                            tool = {'id': 'call_local_test', 'type': 'function',
                                    'function': {'name': name, 'arguments': json.dumps(args)}}
                            break
                text = '本地测试回复：已完成。'
                message = {'role': 'assistant', 'content': None if tool else text}
                if tool:
                    message['tool_calls'] = [tool]
                finish = 'tool_calls' if tool else 'stop'
                base = {'id': 'chatcmpl-local', 'created': int(time.time()),
                        'model': 'local-test-model'}
                self.send_response(200)
                if body.get('stream'):
                    self.send_header('Content-Type', 'text/event-stream')
                    self.end_headers()
                    deltas = [{'role': 'assistant', 'content': ''}]
                    if tool:
                        deltas.append({'tool_calls': [{'index': 0, **tool}]})
                    else:
                        deltas.extend({'content': token} for token in ['本地测试回复：', '已完成。'])
                    for delta in deltas:
                        chunk = {**base, 'object': 'chat.completion.chunk',
                                 'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]}
                        self.wfile.write(('data: ' + json.dumps(chunk, ensure_ascii=False)
                                          + '\n\n').encode('utf-8'))
                    end = {**base, 'object': 'chat.completion.chunk',
                           'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}]}
                    self.wfile.write(('data: ' + json.dumps(end) + '\n\ndata: [DONE]\n\n').encode())
                else:
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({**base, 'object': 'chat.completion',
                        'choices': [{'index': 0, 'message': message, 'finish_reason': finish}],
                        'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}
                    }, ensure_ascii=False).encode('utf-8'))

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self):
        return f'http://127.0.0.1:{self.server.server_port}/v1'

    def start(self):
        self.thread.start()
        return self

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
