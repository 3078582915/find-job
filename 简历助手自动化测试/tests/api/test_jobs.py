import pytest

pytestmark = pytest.mark.api


def test_empty_job_library(api):
    result = api.get('/jobs').json()
    assert result['total'] == 0
    assert result['records'] == []


@pytest.mark.parametrize('filters,expected', [
    ({'keyword': 'React', 'city': '北京', 'platform': 'boss'}, ['job-react-bj']),
    ({'platform': 'zhilian'}, ['job-python-sh']),
    ({'salaryStatus': 'missing'}, ['job-react-sh']),
    ({'companyStatus': 'missing'}, ['job-encoded']),
    ({'keyword': "' OR 1=1 --"}, []),
])
def test_job_filters(api, jobs, filters, expected):
    response = api.get('/jobs', params=filters)
    assert response.status_code == 200
    data = response.json()
    assert sorted(row['id'] for row in data['records']) == sorted(expected)
    assert data['total'] == len(expected)


def test_pagination_and_parameter_boundaries(api, jobs):
    first = api.get('/jobs', params={'size': 2}).json()
    second = api.get('/jobs', params={'size': 2, 'page': 2}).json()
    assert first['total'] == second['total'] == 4
    assert len(first['records']) == len(second['records']) == 2
    assert {r['id'] for r in first['records']}.isdisjoint(r['id'] for r in second['records'])
    normalized = api.get('/jobs', params={'page': -2, 'size': 1000}).json()
    assert normalized['page'] == 1 and normalized['size'] == 100


def test_salary_private_font_decoded(api, jobs):
    rows = api.get('/jobs').json()['records']
    assert next(row['salary'] for row in rows if row['id'] == 'job-encoded') == '11-20K·14薪'


def test_click_is_idempotent_and_history_is_view_history(api, jobs, db):
    path = '/jobs/job-react-bj/click'
    first, second = api.post(path).json(), api.post(path).json()
    assert first['alreadyClicked'] is False
    assert second['alreadyClicked'] is True
    assert first['url'] == 'https://jobs.example.test/job-react-bj'
    assert db.execute('SELECT COUNT(*) FROM job_clicks').fetchone()[0] == 1
    clicked = api.get('/jobs', params={'clickStatus': 'clicked'}).json()
    assert [row['id'] for row in clicked['records']] == ['job-react-bj']
    assert api.get('/jobs', params={'clickStatus': 'unclicked'}).json()['total'] == 3
    history = api.get('/delivery/records').json()
    assert history['total'] == 1 and history['records'][0]['job_id'] == 'job-react-bj'


def test_bulk_delete_cleans_clicks_and_rag_index(api, jobs, db):
    assert api.post('/jobs/rag/reindex').status_code == 200
    api.post('/jobs/job-react-bj/click')
    response = api.post('/jobs/bulk-delete', json={'ids': ['job-react-bj', 'job-react-bj', 'job-python-sh']})
    assert response.json()['deleted'] == 2
    assert api.get('/jobs').json()['total'] == 2
    assert db.execute('SELECT COUNT(*) FROM job_clicks').fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM job_embeddings WHERE job_id IN ('job-react-bj','job-python-sh')").fetchone()[0] == 0


def test_statistics_match_database(api, jobs):
    api.post('/jobs/job-react-bj/click')
    stats = api.get('/statistics').json()
    summary = api.get('/jobs/library-summary').json()
    assert stats['totalJobs'] == 4 and stats['totalClicks'] == 1
    assert summary['salaryMissing'] == summary['companyMissing'] == 1
    assert summary['clicked'] == 1 and summary['unclicked'] == 3


def test_rag_search_returns_relevant_local_job(api, jobs):
    assert api.post('/jobs/rag/reindex').status_code == 200
    response = api.get('/jobs/rag/search', params={'query': 'React 前端', 'city': '北京'})
    assert response.status_code == 200
    assert 'job-react-bj' in [row['id'] for row in response.json()['records']]


@pytest.mark.parametrize('path,payload', [
    ('/jobs/bulk-delete', {'ids': []}),
    ('/jobs/crawl', {'platform': 'boss', 'query': ''}),
    ('/jobs/crawl', {'platform': 'unsupported', 'query': 'Python'}),
])
def test_invalid_job_requests(api, path, payload):
    assert api.post(path, json=payload).status_code == 400


def test_platforms_start_unlogged_in_isolated_environment(api):
    platforms = api.get('/platforms', params={'verify': '1'}).json()
    assert {p['name'] for p in platforms} == {'boss', 'zhilian', '51job', 'shixiseng'}
    assert all(p['loginState'] == 'unlogged' for p in platforms)
