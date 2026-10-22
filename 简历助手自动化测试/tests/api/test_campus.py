import csv
import io

import pytest

pytestmark = pytest.mark.api


def test_campus_crud_trust_and_duplicate(api, site, db):
    identity = site['id']
    assert site['verification_status'] == 'user_confirmed'
    duplicate = api.post('/campus-sites', json={'companyName': '重复公司', 'officialUrl': site['official_url']})
    assert duplicate.status_code == 409
    updated = api.put(f'/campus-sites/{identity}', json={'companyName': '更新测试公司',
        'officialUrl': site['official_url'], 'notes': '修改测试'}).json()
    assert updated['company_name'] == '更新测试公司'
    assert db.execute('SELECT notes FROM campus_sites WHERE id=?', (identity,)).fetchone()[0] == '修改测试'
    assert api.delete(f'/campus-sites/{identity}').status_code == 200
    assert api.get(f'/campus-sites/{identity}').status_code == 404


def test_campus_status_transitions_and_timestamps(api, site):
    path = f'/campus-sites/{site["id"]}/application-status'
    applied = api.patch(path, json={'applicationStatus': 'applied'}).json()
    assert applied['applied_at'] and applied['application_status_updated_at']
    repeated = api.patch(path, json={'applicationStatus': 'applied'}).json()
    assert repeated['applied_at'] == applied['applied_at']
    assert repeated['application_status_updated_at'] == applied['application_status_updated_at']
    terminated = api.patch(path, json={'applicationStatus': 'terminated'}).json()
    assert terminated['terminated_at'] and terminated['applied_at'] == applied['applied_at']
    reset = api.patch(path, json={'applicationStatus': 'not_applied'}).json()
    assert reset['applied_at'] is None and reset['terminated_at'] is None
    assert api.patch(path, json={'applicationStatus': 'invalid'}).status_code == 400


def test_favorite_and_export_respect_filters(api, site):
    assert api.patch(f'/campus-sites/{site["id"]}/favorite', json={'isFavorite': True}).json()['is_favorite'] is True
    api.patch(f'/campus-sites/{site["id"]}/application-status', json={'applicationStatus': 'applied'})
    assert api.post('/campus-sites', json={'companyName': '不应导出的公司',
               'officialUrl': 'https://other.example.com/jobs'}).status_code == 201
    filters = {'keyword': '自动化测试', 'applicationStatus': 'applied'}
    assert api.get('/campus-sites', params=filters).json()['total'] == 1
    response = api.get('/campus-sites/export', params=filters)
    assert response.status_code == 200 and 'text/csv' in response.headers['Content-Type']
    assert response.content.startswith(b'\xef\xbb\xbf')
    rows = list(csv.DictReader(io.StringIO(response.content.decode('utf-8-sig'))))
    assert len(rows) == 1
    assert rows[0]['公司名称'] == site['company_name']
    assert rows[0]['投递状态'] == '已投递' and rows[0]['是否收藏'] == '是'


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'not-a-url', 'http://127.0.0.1/jobs',
                                 'https://user:pass@example.com/jobs'])
def test_unsafe_campus_urls_rejected(api, url):
    assert api.post('/campus-sites', json={'companyName': '测试', 'officialUrl': url}).status_code == 400


def test_agent_cannot_self_declare_unverified_link_as_verified(api):
    response = api.post('/campus-sites', json={'companyName': '未知测试公司',
        'officialUrl': 'https://unverified.example.com/jobs', 'sourceType': 'agent',
        'verificationStatus': 'verified', 'confidence': 100})
    assert response.status_code == 400
    assert api.get('/campus-sites').json()['total'] == 0


def test_invalid_favorite_type_rejected(api, site):
    assert api.patch(f'/campus-sites/{site["id"]}/favorite', json={'isFavorite': 'true'}).status_code == 400
