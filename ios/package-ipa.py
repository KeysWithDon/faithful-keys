"""Package the actual device Release build for later Apple signing."""
from pathlib import Path
import hashlib
import json
import plistlib
import subprocess
import zipfile

app = Path('ios/build/Build/Products/Release-iphoneos/FaithfulKeys.app')
info = plistlib.loads((app / 'Info.plist').read_bytes())
assert info['CFBundleSupportedPlatforms'] == ['iPhoneOS'], 'A simulator app cannot be installed on a phone'
assert int(info['DTSDKName'].removeprefix('iphoneos').split('.')[0]) >= 26, 'Apple uploads require iOS SDK 26 or newer'
executable = app / info['CFBundleExecutable']
architectures = subprocess.check_output(['lipo', '-archs', str(executable)], text=True).split()
assert 'arm64' in architectures and not any(a in architectures for a in ['x86_64', 'i386']), 'Expected a real iPhone binary'
assert (app / 'Web/index.html').is_file(), 'Missing bundled application'
assert (app / 'PrivacyInfo.xcprivacy').is_file(), 'Missing privacy manifest'
assert len(list((app / 'Web/audio').rglob('*.m4a'))) >= 200, 'Incomplete offline piano'
assert not (app / 'embedded.mobileprovision').exists(), 'Unsigned previews must not contain provisioning profiles'
ipa = Path('ios/FaithfulKeys-iPhone-unsigned.ipa')
with zipfile.ZipFile(ipa, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(app.rglob('*')):
        if file.is_file(): archive.write(file, 'Payload/FaithfulKeys.app/' + file.relative_to(app).as_posix())
with zipfile.ZipFile(ipa) as archive:
    assert archive.testzip() is None, 'Corrupt IPA archive'
    assert 'Payload/FaithfulKeys.app/' + info['CFBundleExecutable'] in archive.namelist()
    assert all(name.startswith('Payload/FaithfulKeys.app/') for name in archive.namelist())
report = {
    'file': ipa.name, 'bytes': ipa.stat().st_size,
    'sha256': hashlib.file_digest(ipa.open('rb'), 'sha256').hexdigest(),
    'bundleIdentifier': info['CFBundleIdentifier'], 'minimumIOS': info['MinimumOSVersion'],
    'sdk': info['DTSDKName'], 'architectures': architectures,
    'signed': False, 'requiresAppleSigning': True,
    'appStoreConnectUploadReady': False,
    'note': 'Unsigned device build. Sign using your Apple account before installation. TestFlight requires a signed App Store distribution export and App Store Connect setup.',
}
Path('ios/IPA-BUILD-INFO.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))
