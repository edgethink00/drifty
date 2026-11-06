"""Compare the compiled helper with the Python wire/database oracle."""
from pathlib import Path
import datetime, hashlib, io, json, os, sqlite3, struct, subprocess, sys, tempfile, time, uuid
repo = Path(__file__).resolve().parents[4]
owned_temp = tempfile.TemporaryDirectory(prefix='drifty-native-reader-contract-')
import atexit
atexit.register(owned_temp.cleanup)
out = Path(owned_temp.name)
assert (repo / 'services/tracker-python/app/storage/screen_activity_reader.py').is_file()
sys.path[:0] = [str(repo / 'services/tracker-python'), str(repo / 'services/tracker-python/tests')]
from app.storage.screen_activity_reader import run as python_run
from app.storage.screen_activity_fence import prepare
from test_screen_activity_reader import ScreenActivityReaderTests
exe = Path(sys.argv[1])
assert exe.is_file() and (not exe.is_symlink())
state = out / 'semantic-parity-result-v3.json'
assert not state.exists()
rows = []

def packet(value):
    raw = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    return struct.pack('>I', len(raw)) + raw

def request(operation):
    return {'protocolVersion': 2, 'requestId': str(uuid.uuid4()), 'operation': operation}

def record_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def change(case, sql, args=()):
    with sqlite3.connect(case.path) as connection:
        connection.execute('BEGIN IMMEDIATE')
        prepare(connection)
        connection.execute(sql, args)
        connection.commit()

def test(name, operation=None, mutation=None, raw=None, stream=None, cli=None):
    case = ScreenActivityReaderTests('test_resolve_and_read_have_exact_minimal_wire_and_preserve_database')
    case.setUp()
    try:
        if mutation:
            mutation(case)
        value = request(operation(case) if callable(operation) else operation or {'kind': 'read', 'recordIds': ['1']})
        incoming = stream(case, value) if stream else packet(raw(case, value) if callable(raw) else raw if raw is not None else value)
        before = record_hash(case.path)
        expected = bytearray()
        expected_code = python_run(case.path, io.BytesIO(incoming), expected.extend)
        command = [str(exe), *(cli or ['screen-context-activity-reader-v2', '--db', str(case.path)])]
        if cli:
            expected_code = 2
            expected = bytearray()
        started = time.monotonic()
        result = subprocess.run(command, input=incoming, capture_output=True, timeout=2)
        same = result.returncode == expected_code and result.stdout == expected and (result.stderr == b'') and (record_hash(case.path) == before)
        entry = {'case': name, 'passed': same, 'expectedExit': expected_code, 'actualExit': result.returncode, 'expectedWireBytes': len(expected), 'actualWireBytes': len(result.stdout), 'stderrBytes': len(result.stderr), 'databaseBytesUnchanged': record_hash(case.path) == before, 'elapsedMs': (time.monotonic() - started) * 1000}
        rows.append(entry)
        if not same:
            failure = out / 'failure-v3'
            failure.mkdir(exist_ok=True)
            if case.path.exists():
                (failure / (name + '.sqlite3')).write_bytes(case.path.read_bytes())
            (failure / (name + '-input.bin')).write_bytes(incoming)
            (failure / (name + '-expected.bin')).write_bytes(expected)
            (failure / (name + '-actual.bin')).write_bytes(result.stdout)
            raise AssertionError('Parity mismatch in ' + name)
    finally:
        case.doCleanups()
try:
    test('resolve-valid', lambda c: c.resolve_operation())
    test('read-valid')
    test('replay-valid', {'kind':'read_replay','recordIds':['1']})
    test('replay-titleless', {'kind':'read_replay','recordIds':['1']}, lambda c: change(c, "UPDATE activity_segments SET source='nsworkspace',window_title=NULL WHERE id=1"))
    test('replay-safari-address', {'kind':'read_replay','recordIds':['1']}, lambda c: change(c, "UPDATE activity_segments SET confidence=0.6 WHERE id=1"))
    test('replay-remote', {'kind':'read_replay','recordIds':['1']}, lambda c: change(c, "UPDATE activity_segments SET origin_device_id='remote' WHERE id=1"))
    test('replay-revoked-point', {'kind':'read_replay','recordIds':['1']}, lambda c: change(c, 'INSERT INTO screen_context_activity_revocations VALUES(?,?,?)', (c.uid,c.base+1000,c.base+2000)))
    for confidence in [None, -1.0, 1.1, 0.0, 1.0]:
        test('replay-confidence-' + str(confidence), {'kind':'read_replay','recordIds':['1']}, lambda c, v=confidence: change(c, 'UPDATE activity_segments SET confidence=? WHERE id=1', (v,)))
    test('read-missing', {'kind': 'read', 'recordIds': ['9999', '1']})
    test('read-deleted', mutation=lambda c: change(c, 'DELETE FROM activity_segments'))
    test('read-database-missing', mutation=lambda c: c.path.unlink())
    test('read-database-corrupt', mutation=lambda c: c.path.write_bytes(b'owned corrupt fixture'))
    def lock_database(case):
        # Keep the writer in another process: closing an oracle read fd can
        # release same-process POSIX locks before the native comparison runs.
        lock = subprocess.Popen([sys.executable, '-c',
            "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); "
            "c.execute('BEGIN EXCLUSIVE'); print('locked',flush=True); sys.stdin.read()",
            str(case.path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        case.addCleanup(lambda: lock.communicate(timeout=2))
        assert lock.stdout.readline() == b'locked\n'
    test('read-database-locked', mutation=lock_database)
    test('ambiguous', lambda c: c.resolve_operation(), lambda c: change(c, 'INSERT INTO activity_segments SELECT 2,?,started_at,ended_at,platform,source,bundle_id,window_title,origin_device_id,exclusion_source,engagement_evidence,confidence,site_domain FROM activity_segments WHERE id=1', (str(uuid.uuid4()),)))
    for (name, column, value) in [('imported', 'origin_device_id', 'remote'), ('excluded', 'exclusion_source', 'manual'), ('engagement', 'engagement_evidence', '{}'), ('confidence', 'confidence', 0.99), ('platform', 'platform', 'unknown'), ('source', 'source', 'unknown'), ('app-empty', 'bundle_id', ' '), ('title-empty', 'window_title', ' '), ('title-control', 'window_title', 'bad\nvalue'), ('uid-invalid', 'segment_uid', 'bad')]:
        test(name, mutation=lambda c, k=column, v=value: change(c, 'UPDATE activity_segments SET ' + k + '=? WHERE id=1', (v,)))
    test('revoked-title', mutation=lambda c: change(c, "UPDATE activity_segments SET window_title='changed owned fixture' WHERE id=1"))
    test('site-digest', lambda c: c.resolve_operation(), lambda c: change(c, "UPDATE activity_segments SET site_domain='GitHub.com' WHERE id=1"))
    test('site-digest-private-recorded', lambda c: c.resolve_operation(), lambda c: (change(c, "UPDATE activity_segments SET site_domain='github.com' WHERE id=1"), change(c, "INSERT INTO tracker_meta VALUES ('capture_policy_private_windows','record')")))
    test('revoked-title-resolve', lambda c: c.resolve_operation(), lambda c: change(c, "UPDATE activity_segments SET window_title='changed owned fixture' WHERE id=1"))
    test('uid-replaced', mutation=lambda c: change(c, 'UPDATE activity_segments SET segment_uid=? WHERE id=1', (str(uuid.uuid4()),)))
    test('missing-meta', mutation=lambda c: change(c, 'DELETE FROM screen_context_activity_meta'))
    test('partial-schema', mutation=lambda c: change(c, 'DROP TRIGGER screen_context_activity_update'))
    test('unknown-schema', mutation=lambda c: change(c, 'CREATE TABLE screen_context_activity_unknown(value TEXT)'))
    test('point-revocation', mutation=lambda c: change(c, 'INSERT INTO screen_context_activity_revocations VALUES(?,?,?)', (c.uid, c.base + 1000, c.base + 2000)))
    test('point-resolve-revoked', lambda c: c.resolve_operation(), lambda c: change(c, 'INSERT INTO screen_context_activity_revocations VALUES(?,?,?)', (c.uid, c.base + 1000, c.base + 2000)))

    def many(case, count):
        with sqlite3.connect(case.path) as connection:
            connection.execute('BEGIN IMMEDIATE')
            prepare(connection)
            for i in range(2, count + 1):
                connection.execute('INSERT INTO activity_segments SELECT ?,?,started_at,ended_at,platform,source,bundle_id,window_title,origin_device_id,exclusion_source,engagement_evidence,confidence,site_domain FROM activity_segments WHERE id=1', (i, str(uuid.uuid4())))
            connection.commit()
    test('resolve-over65', lambda c: c.resolve_operation(), lambda c: many(c, 65))
    test('read64-output-bound', {'kind': 'read', 'recordIds': [str(i) for i in range(1, 65)]}, lambda c: many(c, 64))
    stamps = ['2026-01-01T00:00:00.0005+00:00', '2026-01-01T00:00:00.0005009+00:00', '2026-01-01 09:00:00.12345+09:00', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+00:00:00.000001', '2026-01-01🐈00:00:00.123456+00:00', '1970-01-01T00:00:00.000500+00:00', '1969-12-31T23:59:59.999500+00:00', '9999-12-31T23:59:59.999999-23:59', 'bad timestamp']
    for (i, stamp) in enumerate(stamps):
        test('timestamp-' + str(i), mutation=lambda c, s=stamp: change(c, 'UPDATE activity_segments SET started_at=?,ended_at=? WHERE id=1', (s, '2026-01-02T00:00:00+00:00')))
    for (i, raw) in enumerate([b'{bad', b'[]', b'null', b'{"protocolVersion":NaN}', b'\xff', b'{"protocolVersion":2,"protocolVersion":2}', b'{}']):
        test('malformed-' + str(i), raw=raw)
    for (i, op) in enumerate([{'kind': 'read', 'recordIds': ['1', '1']}, {'kind': 'read', 'recordIds': [1]}, {'kind': 'read', 'recordIds': ['0']}, {'kind': 'read', 'recordIds': ['01']}, {'kind': 'read', 'recordIds': ['9223372036854775808']}, {'kind': 'read', 'recordIds': []}, {'kind': 'read', 'recordIds': ['1'], 'dbPath': 'forbidden'}, {'kind': 'query', 'sql': 'SELECT 1'}]):
        test('operation-' + str(i), op)
    for (i, field, value) in [(0, 'protocolVersion', True), (1, 'protocolVersion', 2.0), (2, 'requestId', '00000000-0000-0000-0000-000000000000'), (3, 'dbPath', 'forbidden')]:
        test('top-' + str(i), raw=lambda c, v, k=field, w=value: json.dumps({**v, k: w}).encode())
    test('observed-bool', raw=lambda c, v: json.dumps({**v, 'operation': {**c.resolve_operation(), 'observedAtMs': True}}).encode())
    test('observed-huge', raw=lambda c, v: json.dumps({**v, 'operation': {**c.resolve_operation(), 'observedAtMs': 10 ** 100}}).encode())
    test('short-header', stream=lambda c, v: b'\x00\x00')
    test('oversize-header', stream=lambda c, v: struct.pack('>I', 2049) + b'x' * 2049)
    test('normal-empty-eof', stream=lambda c, v: b'')
    test('64-jobs', stream=lambda c, v: packet(v) * 64)
    test('invalid-serve', cli=['serve'])
    summary = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'passed': True, 'cases': rows, 'count': len(rows), 'sourceOracle': 'Python run/dispatch and original fence fixture', 'exactWireAndExitAndNoStderrAndReadonlyDbCompared': True, 'noProductSourceOrDBChange': True, 'readerAndPreparerNowImplemented': True, 'notProNativeOrP3OrAIQualityAcceptance': True}
except Exception as error:
    summary = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'passed': False, 'cases': rows, 'count': len(rows), 'error': type(error).__name__ + ': ' + str(error), 'failurePreserved': True}
    state.write_text(json.dumps(summary, indent=2) + '\n')
    raise
state.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'passed': summary['passed'], 'cases': len(rows), 'maxRoundTripMs': max((r['elapsedMs'] for r in rows)), 'sourceUnchanged': True}))
