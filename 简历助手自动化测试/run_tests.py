"""Run from any directory; no global pytest plugins or real app data are used."""
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    (HERE / 'reports').mkdir(exist_ok=True)
    env = {**os.environ, 'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1', 'PYTHONUTF8': '1',
           'PYTHONIOENCODING': 'utf-8'}
    result = subprocess.run([sys.executable, '-m', 'pytest',
        '--junitxml=reports/junit.xml', *sys.argv[1:]], cwd=HERE, env=env)
    print(f'\nHTML report: {HERE / "reports/report.html"}')
    sys.exit(result.returncode)
