"""Select an installed stable Xcode that meets Apple's 2026 upload requirement."""
from pathlib import Path
import os
import re
import subprocess

candidates = []
for app in Path('/Applications').glob('Xcode_*.app'):
    version = re.fullmatch(r'Xcode_(\d+(?:\.\d+)*)\.app', app.name)
    if version:
        parts = tuple(map(int, version[1].split('.')))
        if parts[0] >= 26: candidates.append((parts, app))
assert candidates, 'No stable Xcode 26 or newer is installed on this runner'
developer = max(candidates)[1] / 'Contents/Developer'
env = dict(os.environ, DEVELOPER_DIR=str(developer))
subprocess.run(['xcodebuild', '-version'], env=env, check=True)
sdk = subprocess.check_output(['xcrun', '--sdk', 'iphoneos', '--show-sdk-version'], env=env, text=True).strip()
assert int(sdk.split('.')[0]) >= 26, 'iOS SDK 26 or newer is required'
with open(os.environ['GITHUB_ENV'], 'a') as output: output.write(f'DEVELOPER_DIR={developer}\n')
print('Selected iOS SDK', sdk)
