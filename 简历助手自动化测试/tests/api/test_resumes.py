import json

import pytest

pytestmark = pytest.mark.api


def test_resume_lifecycle_and_single_default(api, db):
    response = api.post('/resumes', json={'name': '测试简历', 'content': {'skills': ['Python']}, 'isDefault': True})
    assert response.status_code == 201, response.text
    resume = response.json()
    assert json.loads(resume['content'])['skills'] == ['Python']
    assert sum(row['is_default'] for row in api.get('/resumes').json()) == 1
    assert api.put(f'/resumes/{resume["id"]}', json={'name': '更新后的测试简历'}).status_code == 200
    saved = db.execute('SELECT * FROM resumes WHERE id=?', (resume['id'],)).fetchone()
    assert saved['name'] == '更新后的测试简历'
    assert saved['is_default'] == 1
    assert api.delete(f'/resumes/{resume["id"]}').status_code == 200
    assert db.execute('SELECT 1 FROM resumes WHERE id=?', (resume['id'],)).fetchone() is None


@pytest.mark.parametrize('payload', [{}, {'name': ''}])
def test_empty_resume_name_rejected(api, payload):
    assert api.post('/resumes', json=payload).status_code == 400


def test_whitespace_resume_name_rejected(api):
    response = api.post('/resumes', json={'name': '   '})
    assert response.status_code == 400, f'Whitespace-only name must be rejected; got {response.status_code}: {response.text}'


@pytest.mark.parametrize('method', ['put', 'delete'])
def test_unknown_resume_returns_404(api, method):
    assert api.request(method, '/resumes/does-not-exist', json={}).status_code == 404


def test_delivery_settings_saved_and_limits_normalized(api):
    response = api.put('/delivery/settings', json={'keywords': [' Python ', ''], 'locations': ['北京'],
                       'daily_limit': 999, 'interval_minutes': -10, 'greeting_message': ' 测试问候 '})
    assert response.status_code == 200
    settings = api.get('/delivery/settings').json()
    assert settings['keywords'] == ['Python']
    assert settings['locations'] == ['北京']
    assert settings['daily_limit'] == 300
    assert settings['interval_minutes'] == 1
    assert settings['greeting_message'] == '测试问候'
