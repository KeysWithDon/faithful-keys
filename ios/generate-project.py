"""Generate the checked-in Xcode project with only Python's standard library."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
objects = {}
def identifier(name): return hashlib.sha1(name.encode()).hexdigest()[:24].upper()
def add(object_name, **value):
    key = identifier(object_name)
    objects[key] = value
    return key

def file(name, path, kind):
    return add(name, isa='PBXFileReference', lastKnownFileType=kind, path=path, sourceTree='<group>')
def buildfile(ref): return add('build'+ref, isa='PBXBuildFile', fileRef=ref)

sources = [file('source'+name, name+'.swift', 'sourcecode.swift') for name in ['AppDelegate','AppViewController','MIDIService','MIDIWord','BundleSchemeHandler']]
resources = [file('web', 'Web', 'folder'), file('bridge', 'midi-bridge.js', 'sourcecode.javascript'), file('privacy','PrivacyInfo.xcprivacy','text.xml'), file('assets','Assets.xcassets','folder.assetcatalog')]
info = file('info', 'Info.plist', 'text.plist.xml')
unit = file('unit', 'MIDIWordTests.swift', 'sourcecode.swift')
ui = file('ui', 'AppUITests.swift', 'sourcecode.swift')
products=[]; targets=[]
projectID=identifier('project')
appID=identifier('FaithfulKeys')
for name, tests in [('FaithfulKeys',None),('FaithfulKeysTests','unit'),('FaithfulKeysUITests','ui')]:
    product=add('product'+name, isa='PBXFileReference', explicitFileType='wrapper.application' if not tests else 'wrapper.cfbundle', path=name+('.app' if not tests else '.xctest'), sourceTree='BUILT_PRODUCTS_DIR')
    products.append(product)
    configs=[]
    for mode in ['Debug','Release']:
        settings={'PRODUCT_NAME':'$(TARGET_NAME)', 'PRODUCT_BUNDLE_IDENTIFIER':'com.keyswithdon.'+name.lower(), 'SWIFT_VERSION':'5.0', 'IPHONEOS_DEPLOYMENT_TARGET':'16.0','TARGETED_DEVICE_FAMILY':'1,2','CODE_SIGN_STYLE':'Automatic','SDKROOT':'iphoneos','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST':'NO','LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks'], 'SWIFT_EMIT_LOC_STRINGS':'YES'}
        if not tests:
            settings.update({'INFOPLIST_FILE':'FaithfulKeys/Info.plist','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','MARKETING_VERSION':'0.2.0','CURRENT_PROJECT_VERSION':'1','ENABLE_TESTABILITY':'YES' if mode=='Debug' else 'NO'})
        else:
            settings['GENERATE_INFOPLIST_FILE']='YES'
            if tests=='unit': settings.update({'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/FaithfulKeys.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/FaithfulKeys','BUNDLE_LOADER':'$(TEST_HOST)'})
            else: settings['TEST_TARGET_NAME']='FaithfulKeys'
        configs.append(add(name+mode,isa='XCBuildConfiguration',buildSettings=settings,name=mode))
    configlist=add(name+'configs',isa='XCConfigurationList',buildConfigurations=configs,defaultConfigurationIsVisible=0,defaultConfigurationName='Release')
    src=sources if not tests else [unit if tests=='unit' else ui]
    phases=[add(name+'sources',isa='PBXSourcesBuildPhase',buildActionMask=2147483647,files=[buildfile(ref) for ref in src],runOnlyForDeploymentPostprocessing=0), add(name+'frameworks',isa='PBXFrameworksBuildPhase',buildActionMask=2147483647,files=[],runOnlyForDeploymentPostprocessing=0)]
    if not tests: phases.append(add(name+'resources',isa='PBXResourcesBuildPhase',buildActionMask=2147483647,files=[buildfile(ref) for ref in resources],runOnlyForDeploymentPostprocessing=0))
    dependencies=[]
    if tests:
        proxy=add(name+'proxy',isa='PBXContainerItemProxy',containerPortal=projectID,proxyType=1,remoteGlobalIDString=appID,remoteInfo='FaithfulKeys')
        dependencies=[add(name+'dependency',isa='PBXTargetDependency',target=appID,targetProxy=proxy)]
    targets.append(add(name,isa='PBXNativeTarget',buildConfigurationList=configlist,buildPhases=phases,buildRules=[],dependencies=dependencies,name=name,productName=name,productReference=product,productType='com.apple.product-type.application' if not tests else ('com.apple.product-type.bundle.unit-test' if tests=='unit' else 'com.apple.product-type.bundle.ui-testing')))

groups=[add('appgroup',isa='PBXGroup',children=sources+resources+[info],path='FaithfulKeys',sourceTree='<group>'), add('testgroup',isa='PBXGroup',children=[unit],path='Tests',sourceTree='<group>'),add('uigroup',isa='PBXGroup',children=[ui],path='UITests',sourceTree='<group>')]
productgroup=add('products',isa='PBXGroup',children=products,name='Products',sourceTree='<group>')
main=add('main',isa='PBXGroup',children=groups+[productgroup],sourceTree='<group>')
configs=[]
for mode in ['Debug','Release']:
    configs.append(add('project'+mode,isa='XCBuildConfiguration',name=mode,buildSettings={'CLANG_ENABLE_MODULES':'YES','CLANG_ENABLE_OBJC_ARC':'YES','SWIFT_OPTIMIZATION_LEVEL':'-Onone' if mode=='Debug' else '-O','DEBUG_INFORMATION_FORMAT':'dwarf' if mode=='Debug' else 'dwarf-with-dsym','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else '', 'ONLY_ACTIVE_ARCH':'YES' if mode=='Debug' else 'NO'}))
configlist=add('projectconfigs',isa='XCConfigurationList',buildConfigurations=configs,defaultConfigurationIsVisible=0,defaultConfigurationName='Release')
add('project',isa='PBXProject',attributes={'LastUpgradeCheck':'1600','TargetAttributes':{appID:{'CreatedOnToolsVersion':'16.0'}}},buildConfigurationList=configlist,compatibilityVersion='Xcode 14.0',developmentRegion='en',hasScannedForEncodings=0,knownRegions=['en','Base'],mainGroup=main,productRefGroup=productgroup,projectDirPath='',projectRoot='',targets=targets)

def encode(value,level=0):
    indent='\t'*level
    if isinstance(value,dict): return '{\n'+''.join(indent+'\t'+json.dumps(k)+' = '+encode(v,level+1)+';\n' for k,v in value.items())+indent+'}'
    if isinstance(value,list): return '(\n'+''.join(indent+'\t'+encode(v,level+1)+',\n' for v in value)+indent+')'
    return str(value) if isinstance(value,int) else json.dumps(value)
project=root/'FaithfulKeys.xcodeproj'
project.mkdir(exist_ok=True)
(project/'project.pbxproj').write_text('// !$*UTF8*$!\n'+encode({'archiveVersion':1,'classes':{},'objectVersion':56,'objects':objects,'rootObject':projectID})+'\n')
schemes=project/'xcshareddata'/'xcschemes';schemes.mkdir(parents=True,exist_ok=True)
def ref(name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{identifier(name)}" BuildableName="{name}{".app" if name=="FaithfulKeys" else ".xctest"}" BlueprintName="{name}" ReferencedContainer="container:FaithfulKeys.xcodeproj"/>'
(schemes/'FaithfulKeys.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref('FaithfulKeys')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{ref('FaithfulKeysTests')}</TestableReference><TestableReference skipped="NO">{ref('FaithfulKeysUITests')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref('FaithfulKeys')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref('FaithfulKeys')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/>
<ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print('Generated FaithfulKeys.xcodeproj')
