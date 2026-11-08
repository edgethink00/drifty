"""Real native stdio and owned-reader exchange, with synthetic browser admission."""
import json
import os
import shutil
import sys
import subprocess
import tempfile
import time
import unittest
import selectors
from pathlib import Path
from unittest.mock import patch

from app.tracker.browser_content import capture_browser_content
from app.tracker.macos_capture import CommandScope
from app.storage.db import TrackerDatabase
from app.tracker.browser_content_policy import configure_settings, policy_snapshot, save_content_setting


def native_fixture_source():
    product = Path(__file__).parents[1]/'app/tracker/chatgpt_session_ax.swift'
    source = product.read_text().split('// Browser-owned scripting metadata admits', 1)[0]
    return source + '''let args=CommandLine.arguments
if args.count == 3 && args[1] == "--qa-owned-reader" {
    var child:pid_t = 0
    var childArgs:[UnsafeMutablePointer<CChar>?] = [strdup("/bin/sleep"),strdup("60"),nil]
    var childEnv:[UnsafeMutablePointer<CChar>?] = [nil]
    defer { for argument in childArgs { free(argument) } }
    let status = childArgs.withUnsafeMutableBufferPointer { arguments in
        childEnv.withUnsafeMutableBufferPointer {
            posix_spawn(&child,"/bin/sleep",nil,nil,arguments.baseAddress!,$0.baseAddress!)
        }
    }
    guard status == 0 else { exit(1) }
    let trace:[String:Any] = ["pid":Int(getpid()),"parent":Int(getppid()),"group":Int(getpgrp()),"descendant":Int(child)]
    try! JSONSerialization.data(withJSONObject:trace).write(to:URL(fileURLWithPath:args[2]))
    sleep(60)
    exit(0)
}
let invalidated=ProcessInfo.processInfo.environment["QA_NATIVE_INVALIDATED_PATH"] ?? "/absent"
let mode=ProcessInfo.processInfo.environment["QA_NATIVE_MODE"] ?? "normal"
let descriptionOnly=args[7]=="--public-description-only-stdio"
var clues:[String:Any]=descriptionOnly ? [:] : ["headings":["Current heading"],"visibleTopic":["Current body"]]
var result:[String:Any]=["version":1,"pid":Int(args[2])!,"bundleId":args[3],"pageUrl":args[4],"pageTitle":args[5],"clues":clues]
func emit(_ value:Any){if let data=try?JSONSerialization.data(withJSONObject:value,options:[.fragmentsAllowed]){print(String(decoding:data,as:UTF8.self));fflush(stdout)}}
if mode=="private"{emit(NSNull());exit(0)}
if mode=="no-lookup"{emit(result);exit(0)}
let until=ProcessInfo.processInfo.systemUptime+Double(args[6])!/1000-0.15
var preface=result;preface["phase"]=descriptionOnly ? "publicDescriptionOnly" : "description";preface["lookupBudgetMs"]=max(1,Int((until-ProcessInfo.processInfo.systemUptime)*1000))
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
        # First-launch assessment belongs to fixture preparation, outside the
        # unchanged 650 ms observation budget and its reader-admission reserve.
        prepared = subprocess.run([
            str(cls.helper), '--browser-content', '42', 'com.google.Chrome',
            'https://example.org/course', 'Course', '620', '--description-stdio',
        ], env={**os.environ, 'QA_NATIVE_MODE': 'no-lookup'},
            check=True, capture_output=True, text=True, timeout=5)
        if json.loads(prepared.stdout).get('clues') != {
                'headings': ['Current heading'], 'visibleTopic': ['Current body']}:
            raise AssertionError('Native fixture did not finish preparation')

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

    def run_capture(self, reader_code, *, on_reader_poll=None, native_reader=False):
        reader=self.path/'reader.py'
        reader.write_text('import os,json,subprocess,sys,time\nfrom pathlib import Path\n'
                          "child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n"
                          +'Path('+repr(str(self.trace))+').write_text(json.dumps({"pid":os.getpid(),"parent":os.getppid(),"group":os.getpgrp(),"descendant":child.pid}))\n'+reader_code)
        def run(command, **options):
            self.calls.append(command)
            if command[0]!=str(self.helper):
                command=([str(self.helper),'--qa-owned-reader',str(self.trace)]
                         if native_reader else [sys.executable,str(reader)])
                if on_reader_poll is not None:
                    cancelled=options['cancelled']
                    def poll():
                        on_reader_poll(cancelled)
                        return cancelled()
                    options['cancelled']=poll
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
        initial_policy=policy_snapshot()
        # Prepare the settings writer before the measured capture. Interpreter
        # startup is not the OFF/ON transition this test needs to observe.
        writer=subprocess.Popen([sys.executable,'-u','-c',
            'import json,os,sys\nfrom pathlib import Path\n'
            'from app.storage.db import TrackerDatabase\n'
            'from app.tracker.browser_content_policy import configure_settings,policy_snapshot,save_content_setting\n'
            'db=TrackerDatabase(Path(sys.argv[1]),perform_maintenance=False)\n'
            'configure_settings(db.path)\n'
            'try:\n'
            ' print("ready",flush=True)\n'
            ' for line in sys.stdin:\n'
            '  assert line.strip()=="off-on"\n'
            '  save_content_setting(db,False)\n'
            '  save_content_setting(db,True)\n'
            '  print(json.dumps({"pid":os.getpid(),"revision":policy_snapshot()[1]}),flush=True)\n'
            'finally: db.close()\n',str(database.path)],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,
            env={**os.environ,'PYTHONPATH':os.pathsep.join(filter(None,(
                str(Path(__file__).resolve().parents[1]),os.environ.get('PYTHONPATH'))))})
        def stop_writer():
            writer.stdin.close()
            try:
                writer.wait(timeout=5)
            except subprocess.TimeoutExpired:
                writer.kill();writer.wait(timeout=5)
            finally:
                writer.stdout.close();writer.stderr.close()
            self.assertEqual(writer.returncode,0)
        self.addCleanup(stop_writer)
        def read_writer_line(timeout):
            with selectors.DefaultSelector() as selector:
                selector.register(writer.stdout,selectors.EVENT_READ)
                self.assertTrue(selector.select(timeout),'Settings writer did not acknowledge its fixture command')
            return writer.stdout.readline().strip()
        self.assertEqual(read_writer_line(5),'ready')
        self.assertEqual(policy_snapshot(),initial_policy)
        transitions=[]
        def switch(cancelled):
            if transitions or not self.trace.exists():
                return
            # Only switch after both owned helpers and the reader descendant
            # exist. Finish OFF -> ON before the next real cancellation check,
            # so the test proves generation invalidation rather than seeing OFF.
            self.assertEqual(len(self.scope._children),2)
            self.assertTrue(all(child.poll() is None for child in self.scope._children))
            writer.stdin.write('off-on\n');writer.stdin.flush()
            transitions.append(json.loads(read_writer_line(1)))
            self.assertTrue(cancelled(),'The running transport must observe the committed OFF/ON revision')
        self.scope.deadline=time.monotonic()+2
        result=self.run_capture('time.sleep(60)',on_reader_poll=switch,native_reader=True)
        self.assertEqual(len(transitions),1,'The reader must start and commit OFF/ON before cancellation')
        self.assertNotEqual(transitions[0]['pid'],os.getpid())
        self.assertNotEqual(transitions[0]['revision'],initial_policy[1])
        self.assertIsNotNone(policy_snapshot(),'The final setting is ON; cancellation must use its revision')
        self.assertIsNone(result)
        self.assert_stopped();self.assertFalse(self.scope._children)

    def test_opera_real_stdio_success_and_failed_reader_never_create_body_context(self):
        self.arguments["bundle_id"] = "com.operasoftware.Opera"
        result = self.run_capture("print(json.dumps({'description':'Public summary'}),flush=True)")
        self.assertEqual({k: result[k] for k in ('description',)}, {'description': 'Public summary'})
        self.assertNotIn('headings', result); self.assertNotIn('visibleTopic', result)
        self.assert_stopped()
        for code in ("time.sleep(60)", "print('null')", "print('not-json')"):
            with self.subTest(code=code):
                self.scope.deadline = time.monotonic()+2
                self.assertIsNone(self.run_capture(code))
                self.assert_stopped()

    def test_opera_real_stdio_invalidation_discards_description(self):
        self.arguments["bundle_id"] = "com.operasoftware.Opera"
        self.assertIsNone(self.run_capture('Path('+repr(str(self.invalidated))+').touch();time.sleep(.05);print(json.dumps({"description":"Late description"}))'))
        self.assert_stopped()

    def test_opera_cross_process_off_on_cancels_owned_reader(self):
        self.arguments["bundle_id"] = "com.operasoftware.Opera"
        self.test_cross_process_setting_off_on_during_lookup_cancels_both_helpers()


if __name__ == '__main__':
    unittest.main()
