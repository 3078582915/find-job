"""Managed local services, per-test data isolation, and self-contained reports."""
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sqlite3
import subprocess
import time
import uuid

import pytest
import requests
from playwright.sync_api import sync_playwright

from model_stub import ModelStub

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPORTS = HERE / 'reports'


def pytest_addoption(parser):
    parser.addoption('--headed', action='store_true', help='Show the test browser')
    parser.addoption('--browser-channel', default=None, help='chrome or msedge; bundled Chromium by default')


def pytest_configure(config):
    if hasattr(config, 'workerinput') or getattr(config.option, 'numprocesses', None):
        raise pytest.UsageError('Shared test database: run serially; pytest-xdist is not supported.')
    REPORTS.mkdir(exist_ok=True)
    config.test_results = {}
    config.test_started = time.time()


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    result = yield
    report = result.get_result()
    setattr(item, f'rep_{report.when}', report)
    rows = item.config.test_results
    row = rows.setdefault(item.nodeid, {'test': item.nodeid, 'outcome': 'passed', 'seconds': 0,
                                        'details': '', 'artifacts': []})
    row['seconds'] += report.duration
    if report.failed or (report.skipped and row['outcome'] != 'failed'):
        row['outcome'] = report.outcome
        row['details'] += str(report.longrepr) + '\n'


def pytest_sessionfinish(session, exitstatus):
    rows = list(session.config.test_results.values())
    summary = {name: sum(row['outcome'] == name for row in rows)
               for name in ['passed', 'failed', 'skipped']}
    payload = {'exit_code': int(exitstatus), 'duration_seconds': time.time() - session.config.test_started,
               'summary': summary, 'tests': rows}
    (REPORTS / 'results.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    body = []
    for row in rows:
        links = ' '.join(f'<a href="{html.escape(p)}">{html.escape(Path(p).name)}</a>'
                         for p in row['artifacts'])
        body.append(f'<tr><td>{html.escape(row["test"])}</td><td class="{row["outcome"]}">{row["outcome"]}</td>'
                    f'<td>{row["seconds"]:.2f}s</td><td>{links}'
                    f'<details><summary>详情</summary><pre>{html.escape(row["details"])}</pre></details></td></tr>')
    document = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>简历助手测试报告</title>'
    document += '<style>body{font:15px system-ui;margin:32px;color:#17324d}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:left}pre{white-space:pre-wrap;max-width:900px}.passed{color:green}.failed{color:#c22}.skipped{color:#a70}a{margin-right:10px}</style>'
    document += f'<h1>简历助手自动化测试</h1><p>通过 {summary["passed"]} · 失败 {summary["failed"]} · 跳过 {summary["skipped"]} · 退出码 {exitstatus}</p>'
    document += '<p>真实本地前后端 + 独立 SQLite；模型响应来自本地模拟服务。外部招聘站点不在本报告验证范围。</p>'
    document += '<table><tr><th>用例</th><th>结果</th><th>耗时</th><th>证据</th></tr>' + ''.join(body) + '</table></html>'
    (REPORTS / 'report.html').write_text(document, encoding='utf-8')


class Api:
    def __init__(self, base):
        self.base = base
        self.session = requests.Session()
        self.session.trust_env = False

    def request(self, method, path, **kwargs):
        kwargs.setdefault('timeout', 30)
        return self.session.request(method, self.base + '/api' + path, **kwargs)

    def get(self, path, **kwargs):
        return self.request('GET', path, **kwargs)

    def post(self, path, **kwargs):
        return self.request('POST', path, **kwargs)

    def put(self, path, **kwargs):
        return self.request('PUT', path, **kwargs)

    def patch(self, path, **kwargs):
        return self.request('PATCH', path, **kwargs)

    def delete(self, path, **kwargs):
        return self.request('DELETE', path, **kwargs)


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def start_service(command, cwd, env, url, log_path):
    log = log_path.open('w', encoding='utf-8')
    try:
        proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        api = requests.Session()
        api.trust_env = False
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                break
            try:
                if api.get(url, timeout=1).status_code == 200:
                    return proc, log
            except requests.RequestException:
                pass
            time.sleep(0.2)
        stop_service(proc)
        pytest.fail(f'Service startup failed; see {log_path}\n' + log_path.read_text(encoding='utf-8', errors='replace')[-4000:])
    finally:
        if 'proc' not in locals() or proc.poll() is not None:
            log.close()


def stop_service(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


@pytest.fixture(scope='session')
def app():
    node = shutil.which('node')
    for dependency in [ROOT / 'server/node_modules/tsx/dist/cli.mjs', ROOT / 'client/node_modules/vite/bin/vite.js']:
        if not dependency.exists():
            pytest.fail(f'Missing Node dependency: {dependency}. Run npm.cmd run install:all at the project root.')
    if not node:
        pytest.fail('Node.js is required.')
    run_dir = HERE / '.runtime' / uuid.uuid4().hex
    run_dir.mkdir(parents=True)
    empty_env = run_dir / 'empty.env'
    empty_env.write_text('', encoding='utf-8')
    backend_port, frontend_port = free_port(), free_port()
    while frontend_port == backend_port:
        frontend_port = free_port()
    backend = f'http://127.0.0.1:{backend_port}'
    frontend = f'http://127.0.0.1:{frontend_port}'
    model = ModelStub().start()
    env = {**os.environ, 'APP_DATA_DIR': str(run_dir), 'PORT': str(backend_port),
           'APP_CLIENT_ORIGIN': frontend, 'API_PROXY_TARGET': backend,
           'AGENT_API_KEY': 'local-test-key-0000', 'OPENAI_API_KEY': '',
           'AGENT_MODEL': 'local-test-model', 'AGENT_BASE_URL': model.url,
           'DOTENV_CONFIG_PATH': str(empty_env), 'LANGSMITH_TRACING': 'false',
           'LANGCHAIN_TRACING_V2': 'false', 'NODE_USE_ENV_PROXY': '0'}
    services = []
    try:
        services.append(start_service([node, '--import', 'tsx', 'src/index.ts'], ROOT / 'server', env,
                                     backend + '/api/health', REPORTS / 'backend.log'))
        services.append(start_service([node, str(ROOT / 'client/node_modules/vite/bin/vite.js'),
                                       '--host', '127.0.0.1', '--port', str(frontend_port), '--strictPort'],
                                      ROOT / 'client', env, frontend, REPORTS / 'frontend.log'))
        db_path = run_dir / 'app.db'
        with sqlite3.connect(db_path) as connection:
            tables = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            baseline = {table: connection.execute(f'SELECT * FROM "{table}"').fetchall() for table in tables}
        yield {'backend': backend, 'frontend': frontend, 'database': db_path,
               'model': model, 'baseline': baseline, 'run_dir': run_dir}
    finally:
        for proc, log in reversed(services):
            stop_service(proc)
            log.close()
        model.close()


@pytest.fixture(scope='session')
def api(app):
    client = Api(app['backend'])
    yield client
    client.session.close()


@pytest.fixture(autouse=True)
def isolated_data(app, api):
    # One transaction restores only the private test database before every test.
    with sqlite3.connect(app['database'], timeout=15) as connection:
        for table in app['baseline']:
            connection.execute(f'DELETE FROM "{table}"')
        for table, rows in app['baseline'].items():
            if rows:
                marks = ','.join('?' for _ in rows[0])
                connection.executemany(f'INSERT INTO "{table}" VALUES ({marks})', rows)
    app['model'].calls.clear()
    response = api.put('/agent/config', json={'apiKey': 'local-test-key-0000',
        'model': 'local-test-model', 'baseUrl': app['model'].url})
    assert response.status_code == 200, response.text


@pytest.fixture
def db(app):
    connection = sqlite3.connect(app['database'], timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    yield connection
    connection.close()


@pytest.fixture
def jobs(db):
    rows = [
        ('job-react-bj', 'boss', 'React 前端工程师', '测试科技', '20-30K', '北京'),
        ('job-python-sh', 'zhilian', 'Python 后端工程师', '测试数据', '25-35K', '上海'),
        ('job-react-sh', 'boss', 'React 实习工程师', '测试研发', '', '上海'),
        ('job-encoded', 'boss', 'Agent 开发工程师', '', '\ue032\ue032-\ue033\ue031K·\ue032\ue035薪', '北京'),
    ]
    db.executemany('INSERT INTO jobs (id, platform, title, company_name, salary, location, job_url, job_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                   [(*row, f'https://jobs.example.test/{row[0]}', row[0], '["技术"]') for row in rows])
    db.commit()
    return [row[0] for row in rows]


@pytest.fixture
def site(api):
    response = api.post('/campus-sites', json={'companyName': '自动化测试公司',
        'officialUrl': 'https://campus.example.com/jobs', 'tags': ['校招', '测试']})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture(scope='session')
def browser(pytestconfig):
    with sync_playwright() as playwright:
        channel = pytestconfig.getoption('--browser-channel')
        if not channel:
            try:
                bundled_available = Path(playwright.chromium.executable_path).exists()
            except PermissionError:
                bundled_available = False
            if not bundled_available:
                channel = 'chrome'  # Reuse installed Chrome when bundled Chromium is absent.
        instance = playwright.chromium.launch(channel=channel,
                    headless=not pytestconfig.getoption('--headed'))
        yield instance
        instance.close()


@pytest.fixture
def page(browser, app, request):
    context = browser.new_context(base_url=app['frontend'], viewport={'width': 1440, 'height': 1000},
                                  locale='zh-CN', timezone_id='Asia/Shanghai')
    # Accidental external navigation is blocked; only the local app is exercised.
    context.route(re.compile(r'^https?://'), lambda route: route.continue_()
                  if route.request.url.startswith(app['frontend'] + '/') else route.abort())
    context.tracing.start(screenshots=True, snapshots=True, sources=True)
    current = context.new_page()
    current.set_default_timeout(10000)
    yield current
    identity = hashlib.sha1(request.node.nodeid.encode()).hexdigest()[:12]
    artifact_dir = REPORTS / 'artifacts'
    artifact_dir.mkdir(exist_ok=True)
    failed = any(getattr(request.node, f'rep_{phase}', None) and
                 getattr(request.node, f'rep_{phase}').failed for phase in ['setup', 'call'])
    try:
        if failed:
            screenshot = artifact_dir / f'{identity}.png'
            trace = artifact_dir / f'{identity}-trace.zip'
            current.screenshot(path=str(screenshot), full_page=True)
            context.tracing.stop(path=str(trace))
            request.config.test_results[request.node.nodeid]['artifacts'] = [
                str(screenshot.relative_to(REPORTS)).replace('\\', '/'),
                str(trace.relative_to(REPORTS)).replace('\\', '/')]
        else:
            context.tracing.stop()
    finally:
        context.close()
