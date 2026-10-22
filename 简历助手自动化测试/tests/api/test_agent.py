import json

import pytest

pytestmark = [pytest.mark.api, pytest.mark.agent]


def chat(api, message, conversation_id=None):
    payload = {'message': message}
    if conversation_id:
        payload['conversationId'] = conversation_id
    response = api.post('/agent/chat', json=payload)
    assert response.status_code == 200, response.text
    assert 'text/event-stream' in response.headers['Content-Type']
    events = []
    for block in response.text.replace('\r\n', '\n').split('\n\n'):
        fields = dict(line.split(':', 1) for line in block.splitlines() if ':' in line)
        if 'event' in fields and 'data' in fields:
            events.append((fields['event'].strip(), json.loads(fields['data'])))
    return events


def action_from_chat(api):
    events = chat(api, '[test:crawl] 准备抓取任务')
    assert 'error' not in [name for name, _ in events], events
    return next(data['action'] for name, data in events if name == 'artifact' and data['kind'] == 'confirmation')


def test_model_config_masks_key_and_connects_locally(api, app):
    response = api.get('/agent/config')
    assert response.json()['configured'] is True
    assert 'local-test-key-0000' not in response.text
    assert 'apiKey' not in response.json()
    checked = api.post('/agent/config/test').json()
    assert checked['success'] is True
    assert app['model'].calls, 'Connection test must reach the local model stub'


def test_conversation_crud(api):
    conversation = api.post('/agent/conversations', json={'title': '测试对话'}).json()
    assert any(row['id'] == conversation['id'] for row in api.get('/agent/conversations').json())
    assert api.get(f'/agent/conversations/{conversation["id"]}/messages').json() == []
    assert api.delete(f'/agent/conversations/{conversation["id"]}').status_code == 200
    assert api.get(f'/agent/conversations/{conversation["id"]}/messages').status_code == 404


def test_sse_search_calls_real_tool_and_persists_messages(api, jobs, db):
    events = chat(api, '[test:search] 找北京 React 岗位')
    names = [name for name, _ in events]
    assert {'conversation', 'token', 'tool_start', 'tool_end', 'artifact', 'done'}.issubset(names), events
    assert 'error' not in names
    artifact = next(data for name, data in events if name == 'artifact' and data['kind'] == 'job_list')
    assert [row['id'] for row in artifact['jobs']] == ['job-react-bj']
    conversation = next(data['conversation'] for name, data in events if name == 'conversation')
    messages = api.get(f'/agent/conversations/{conversation["id"]}/messages').json()
    assert [row['role'] for row in messages] == ['user', 'assistant']
    assert '本地测试回复' in messages[-1]['content']
    assert db.execute("SELECT COUNT(*) FROM agent_action_logs WHERE tool_name='search_jobs'").fetchone()[0] == 1
    again = chat(api, '继续对话', conversation['id'])
    assert 'done' in [name for name, _ in again]
    assert len(api.get(f'/agent/conversations/{conversation["id"]}/messages').json()) == 4


def test_crawl_preparation_and_cancel_never_crawl(api, db):
    action = action_from_chat(api)
    assert db.execute('SELECT status FROM agent_pending_actions WHERE id=?', (action['id'],)).fetchone()[0] == 'pending'
    assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0
    assert api.post(f'/agent/actions/{action["id"]}/cancel').json()['action']['status'] == 'cancelled'
    assert api.post(f'/agent/actions/{action["id"]}/cancel').status_code == 409
    assert api.post(f'/agent/actions/{action["id"]}/confirm').status_code == 409
    assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0


def test_agent_statistics_use_database(api, jobs):
    events = chat(api, '[test:stats] 统计职位库')
    assert 'error' not in [name for name, _ in events], events
    artifact = next(data for name, data in events if name == 'artifact' and data['kind'] == 'statistics')
    assert artifact['statistics']['total'] == 4
    assert artifact['statistics']['salaryMissing'] == 1


def test_confirm_unlogged_platform_is_safe_and_cannot_repeat(api, db):
    action = action_from_chat(api)
    response = api.post(f'/agent/actions/{action["id"]}/confirm')
    assert response.status_code == 200, response.text
    assert response.json()['action']['result']['needLogin'] is True
    assert api.post(f'/agent/actions/{action["id"]}/confirm').status_code == 409
    assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0


def test_expired_confirmation_rejected(api, db):
    action = action_from_chat(api)
    db.execute("UPDATE agent_pending_actions SET expires_at='2000-01-01 00:00:00' WHERE id=?", (action['id'],))
    db.commit()
    assert api.post(f'/agent/actions/{action["id"]}/confirm').status_code == 409


def test_model_error_returns_sse_error_without_false_success(api):
    events = chat(api, '[test:error]')
    names = [name for name, _ in events]
    assert 'error' in names and 'done' not in names
    error = next(data for name, data in events if name == 'error')
    assert error['status'] == 503  # Invalid credentials are classified as a configuration error.


@pytest.mark.parametrize('payload,status', [({'message': '   '}, 400),
    ({'message': '测试', 'conversationId': 'missing'}, 404)])
def test_invalid_chat_request(api, payload, status):
    assert api.post('/agent/chat', json=payload).status_code == status
