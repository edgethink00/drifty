"""Real native stdio and owned-reader exchange, with synthetic browser admission."""
import json
import os
import shutil
import sys
import subprocess
import tempfile
import time
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from app.tracker.browser_content import capture_browser_content
from app.tracker.macos_capture import CommandScope
from app.storage.db import TrackerDatabase
from app.tracker.browser_content_policy import configure_settings, save_content_setting


def native_fixture_source():
    product = Path(__file__).parents[1]/'app/tracker/chatgpt_session_ax.swift'
    source = product.read_text().split('// Browser-owned scripting metadata admits', 1)[0]
    return source + '''let args=CommandLine.arguments
let invalidated=ProcessInfo.processInfo.environment["QA_NATIVE_INVALIDATED_PATH"] ?? "/absent"
let mode=ProcessInfo.processInfo.environment["QA_NATIVE_MODE"] ?? "normal"
var clues:[String:Any]=["headings":["Current heading"],"visibleTopic":["Current body"]]
var result:[String:Any]=["version":1,"pid":Int(args[2])!,"bundleId":args[3],"pageUrl":args[4],"pageTitle":args[5],"clues":clues]
func emit(_ value:Any){if let data=try?JSONSerialization.data(withJSONObject:value,options:[.fragmentsAllowed]){print(String(decoding:data,as:UTF8.self));fflush(stdout)}}
if mode=="private"{emit(NSNull());exit(0)}
if mode=="no-lookup"{emit(result);exit(0)}
let until=ProcessInfo.processInfo.systemUptime+Double(args[6])!/1000-0.15
var preface=result;preface["phase"]="description";preface["lookupBudgetMs"]=max(1,Int((until-ProcessInfo.processInfo.systemUptime)*1000))
emit(preface)
if let text=readDescriptionReply(deadline:until,valid:{!FileManager.default.fileExists(atPath:invalidated)}){clues["description"]=text;result["clues"]=clues}
if FileManager.default.fileExists(atPath:invalidated){emit(NSNull())}else{emit(result)}
'''


@unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'), 'macOS stdio integration')
class NativeDescriptionTransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(); cls.root=Path(cls.temp.name)
        source=cls.root/'transport.swift'; source.write_text(native_fixture_source())
        cls.helper=cls.root/'transport'
        subprocess.run(['xcrun','swiftc','-O',str(source),'-o',str(cls.helper)], check=True, capture_output=True, timeout=60)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.path=Path(self.directory.name); self.trace=self.path/'trace.json'; self.invalidated=self.path/'invalidated'
        env=patch.dict(os.environ, {'DRIFTY_BROWSER_CONTENT_CONTEXT':'1','QA_NATIVE_INVALIDATED_PATH':str(self.invalidated),'QA_NATIVE_MODE':'normal'})
        env.start(); self.addCleanup(env.stop)
        settings=patch('app.tracker.browser_content_policy._settings_path', None);settings.start();self.addCleanup(settings.stop)
        self.calls=[]
        self.scope=CommandScope(time.monotonic()+2);self.addCleanup(self.scope.close)
        self.arguments=dict(pid=42,bundle_id='com.google.Chrome',page_url='https://example.org/course',page_title='Course',observed_at='2026-10-07T00:00:00Z',helper_path=self.helper)

    def run_capture(self, reader_code):
        reader=self.path/'reader.py'
        reader.write_text('import os,json,subprocess,sys,time\nfrom pathlib import Path\n'
                          "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n"
                          +'Path('+repr(str(self.trace))+').write_text(json.dumps({"pid":os.getpid(),"parent":os.getppid(),"group":os.getpgrp(),"descendant":child.pid}))\n'+reader_code)
        def run(command, **options):
            self.calls.append(command)
            if command[0]!=str(self.helper):command=[sys.executable,str(reader)]
            return self.scope.run(command, **options)
        return capture_browser_content(**self.arguments,run_command=run)

    def assert_stopped(self):
        data=json.loads(self.trace.read_text())
        self.assertEqual(data['parent'],os.getpid()) # Direct reader parent, no native intermediary.
        self.assertEqual(data['pid'],data['group']) # Independently registered owned group.
        for pid in (data['pid'],data['descendant']):
            end=time.monotonic()+1
            while time.monotonic()<end:
                state=subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
                if not state or state.startswith('Z'):break
                time.sleep(.01)
            self.assertTrue(not state or state.startswith('Z'),'Owned reader descendant still running')

    def test_description_success_preserves_native_hb_and_cleans_owned_reader_tree(self):
        result=self.run_capture("print(json.dumps({'description':'Public summary'}),flush=True)")
        self.assertEqual(result['description'],'Public summary')
        self.assertEqual(result['headings'],['Current heading']);self.assertEqual(result['visibleTopic'],['Current body'])
        self.assert_stopped()

    def test_timeout_missing_and_malformed_description_preserve_hb(self):
        for code in ("time.sleep(60)", "print('null')", "print('not-json')", "print(json.dumps({'description':'x'*161}))"):
            with self.subTest(code=code):
                self.scope.deadline=time.monotonic()+2
                result=self.run_capture(code)
                self.assertNotIn('description',result)
                self.assertEqual(result['headings'],['Current heading']);self.assertEqual(result['visibleTopic'],['Current body'])
                self.assert_stopped()

    def test_invalidation_while_reader_runs_discards_entire_observation(self):
        result=self.run_capture('Path('+repr(str(self.invalidated))+').touch();time.sleep(.05);print(json.dumps({"description":"Late description"}))')
        self.assertIsNone(result);self.assert_stopped()

    def test_private_and_no_lookup_observations_never_start_reader(self):
        for mode in ('private','no-lookup'):
            with self.subTest(mode=mode),patch.dict(os.environ,{'QA_NATIVE_MODE':mode}):
                self.calls.clear();self.scope.deadline=time.monotonic()+2
                result=self.run_capture("raise AssertionError('reader must not start')")
                self.assertEqual(len(self.calls),1)
                self.assertIsNone(result) if mode=='private' else self.assertEqual(result['headings'],['Current heading'])

    def test_cross_process_setting_off_on_during_lookup_cancels_both_helpers(self):
        database=TrackerDatabase(self.path/'settings.sqlite3',perform_maintenance=False)
        self.addCleanup(database.close);configure_settings(database.path);save_content_setting(database,True)
        errors=[]
        def switch():
            try:
                until=time.monotonic()+1
                while not self.trace.exists() and time.monotonic()<until:time.sleep(.002)
                other=TrackerDatabase(database.path,perform_maintenance=False)
                try:
                    save_content_setting(other,False);save_content_setting(other,True)
                finally:other.close()
            except Exception as error:errors.append(type(error).__name__)
        thread=threading.Thread(target=switch);thread.start()
        result=self.run_capture('time.sleep(.3);print(json.dumps({"description":"Late description"}))')
        thread.join(2)
        self.assertEqual(errors,[]);self.assertFalse(thread.is_alive());self.assertIsNone(result)
        self.assert_stopped();self.assertFalse(self.scope._children)


if __name__ == '__main__':
    unittest.main()
