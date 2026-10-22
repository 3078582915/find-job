import csv
import io

import pytest
from playwright.sync_api import expect

pytestmark = pytest.mark.e2e


@pytest.mark.parametrize('path,title', [('/jobs', '职位广场'), ('/campus-sites', '校招官网'),
    ('/resume', '简历管理'), ('/dashboard', '仪表盘'), ('/platforms', '平台管理')])
def test_page_smoke(page, path, title):
    page.goto(path)
    expect(page.get_by_role('heading', name=title, exact=True)).to_be_visible()


def test_resume_create_default_reload_and_delete(page, api):
    page.goto('/resume')
    page.get_by_role('button', name='+ 添加新简历').click()
    page.get_by_placeholder('例如：前端开发简历-标准版').fill('浏览器测试简历')
    page.get_by_placeholder('例如：高级前端开发工程师').fill('自动化测试工程师')
    page.get_by_placeholder('例如：React, TypeScript, Node.js').fill('Python, Playwright')
    page.get_by_role('button', name='添加', exact=True).click()
    card = page.locator('div.relative').filter(has=page.get_by_role('heading', name='浏览器测试简历', exact=True))
    expect(card).to_be_visible()
    expect(card.get_by_text('Python', exact=True)).to_be_visible()
    card.get_by_role('button', name='设为默认').click()
    expect(card.get_by_text('★ 默认', exact=True)).to_be_visible()
    page.reload()
    expect(card.get_by_text('★ 默认', exact=True)).to_be_visible()
    assert sum(row['is_default'] for row in api.get('/resumes').json()) == 1
    page.once('dialog', lambda dialog: dialog.accept())
    card.get_by_role('button', name='删除', exact=True).click()
    expect(page.get_by_role('heading', name='浏览器测试简历', exact=True)).to_have_count(0)
    assert all(row['name'] != '浏览器测试简历' for row in api.get('/resumes').json())


def test_job_search_and_batch_delete(page, api, jobs):
    page.goto('/jobs')
    expect(page.get_by_role('heading', name='React 前端工程师', exact=True)).to_be_visible()
    page.get_by_placeholder('搜索职位/公司').fill('React')
    platform = page.locator('select').filter(has=page.locator('option', has_text='全部平台'))
    city = page.locator('select').filter(has=page.locator('option', has_text='全部城市'))
    platform.select_option('boss')
    city.select_option('北京')
    expect(page.get_by_role('heading', name='React 实习工程师', exact=True)).to_have_count(0)
    expect(page.get_by_text('共 1 个职位', exact=True)).to_be_visible()
    page.get_by_role('checkbox', name='选择 React 前端工程师', exact=True).check()
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='删除选中', exact=True).click()
    expect(page.get_by_text('暂无职位数据', exact=True)).to_be_visible()
    assert api.get('/jobs').json()['total'] == 3


def test_campus_create_status_favorite_export_and_delete(page, api, tmp_path):
    page.goto('/campus-sites')
    page.get_by_role('button', name='添加官网', exact=True).click()
    page.get_by_label('公司名称', exact=True).fill('浏览器校招公司')
    page.get_by_label('链接地址', exact=True).fill('https://browser.example.com/campus')
    page.get_by_role('button', name='保存官网', exact=True).click()
    card = page.locator('article').filter(has=page.get_by_role('heading', name='浏览器校招公司', exact=True))
    expect(card).to_be_visible()
    card.get_by_role('combobox').select_option('applied')
    expect(card.get_by_role('combobox')).to_be_enabled()
    card.get_by_role('button', name='收藏链接', exact=True).click()
    expect(card.get_by_role('button', name='取消收藏', exact=True)).to_be_visible()
    page.reload()
    expect(card.get_by_role('combobox')).to_have_value('applied')
    expect(card.get_by_role('button', name='取消收藏', exact=True)).to_be_visible()
    with page.expect_download() as download_info:
        page.get_by_title('导出当前筛选结果', exact=True).click()
    download = download_info.value
    path = tmp_path / 'campus.csv'
    download.save_as(path)
    rows = list(csv.DictReader(io.StringIO(path.read_text(encoding='utf-8-sig'))))
    assert len(rows) == 1 and rows[0]['公司名称'] == '浏览器校招公司'
    assert rows[0]['投递状态'] == '已投递'
    page.once('dialog', lambda dialog: dialog.accept())
    card.get_by_title('删除官网', exact=True).click()
    expect(card).to_have_count(0)
    assert api.get('/campus-sites').json()['total'] == 0


@pytest.mark.agent
def test_agent_stream_search_and_reload(page, jobs):
    page.goto('/')
    field = page.get_by_placeholder('输入职位条件、统计问题或抓取任务')
    expect(field).to_be_enabled()
    field.fill('[test:search] 找北京 React 岗位')
    page.get_by_title('发送', exact=True).click()
    reply = page.locator('main p').filter(has_text='本地测试回复：已完成。')
    expect(reply).to_be_visible(timeout=20000)
    expect(page.get_by_role('heading', name='React 前端工程师', exact=True)).to_be_visible()
    expect(field).to_be_enabled()
    page.reload()
    expect(reply).to_be_visible()
    expect(page.get_by_role('heading', name='React 前端工程师', exact=True)).to_be_visible()


@pytest.mark.agent
def test_agent_cancel_confirmation_persists(page, db):
    page.goto('/')
    field = page.get_by_placeholder('输入职位条件、统计问题或抓取任务')
    expect(field).to_be_enabled()
    field.fill('[test:crawl] 准备抓取任务')
    page.get_by_title('发送', exact=True).click()
    expect(page.get_by_role('button', name='确认执行', exact=True).first).to_be_visible(timeout=20000)
    expect(field).to_be_enabled()
    page.get_by_role('button', name='取消', exact=True).last.click()
    expect(page.get_by_role('button', name='确认执行', exact=True)).to_have_count(0)
    page.reload()
    expect(page.get_by_text('已取消', exact=True)).to_be_visible()
    assert db.execute('SELECT status FROM agent_pending_actions').fetchone()[0] == 'cancelled'
    assert db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] == 0


def test_campus_api_error_is_visible(page):
    page.route('**/api/campus-sites?*', lambda route: route.fulfill(
        status=500, content_type='application/json', body='{"error":"测试服务暂不可用"}'))
    page.goto('/campus-sites')
    expect(page.get_by_text('测试服务暂不可用', exact=True)).to_be_visible()
