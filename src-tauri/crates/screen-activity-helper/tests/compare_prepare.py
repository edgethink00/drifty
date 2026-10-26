"""Compare the compiled helper with the unmodified Python wire/database oracle."""
from pathlib import Path
import hashlib, json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, uuid
from unittest.mock import patch
repo = Path(__file__).resolve().parents[4]
owned_temp = tempfile.TemporaryDirectory(prefix='drifty-native-preparer-contract-')
import atexit
atexit.register(owned_temp.cleanup)
out = Path(owned_temp.name)
sys.path[:0] = [str(repo / 'services/tracker-python')]
from app.screen_activity_main import main as python_main
from app.storage.screen_activity_fence import prepare as python_prepare, SCHEMA, read_state
from app.storage.screen_activity_prepare import runtime_fingerprint
exe = Path(sys.argv[1])
report = out / 'prepare-parity-result-v3.json'
assert not report.exists()
cases = []

def connect(path):
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE tracker_meta(key TEXT PRIMARY KEY,value TEXT)')
    db.execute('CREATE TABLE activity_segments(id INTEGER PRIMARY KEY,segment_uid TEXT,started_at TEXT,ended_at TEXT,platform TEXT,source TEXT,bundle_id TEXT,window_title TEXT,origin_device_id TEXT,exclusion_source TEXT,engagement_evidence TEXT,confidence REAL)')
    db.execute('INSERT INTO activity_segments VALUES(1,?,?,?,?,?,?,?,?,?,?,?)', (str(uuid.uuid4()), '2026-01-01T00:00:00+00:00', '2026-01-01T00:01:00+00:00', 'macos', 'accessibility', 'com.apple.TextEdit', 'Owned synthetic fixture', None, None, None, 1.0))
    db.commit()
    return db

def snapshot(path):
    if not path.is_file():
        return None
    with sqlite3.connect(path) as db:
        objects = db.execute("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        data = {}
        for (name, kind, _) in objects:
            if kind != 'table':
                continue
            rows = db.execute('SELECT * FROM ' + name + ' ORDER BY 1').fetchall()
            if name == 'screen_context_activity_meta':
                rows = [(a, b, '<random32hex>' if isinstance(epoch, str) and re.fullmatch('[0-9a-f]{32}', epoch) else epoch) for (a, b, epoch) in rows]
            data[name] = rows
        return {'objects': objects, 'data': data}

def oracle(db, producer, extra=None):
    output = bytearray()

    def write(fd, data):
        assert fd == 1
        output.extend(data)
        return len(data)
    with patch('os.write', write):
        code = python_main(extra or ['screen-context-activity-prepare-v1', '--db', str(db), '--producer-runtime', str(producer)])
    return (code, bytes(output))

def one(name, kind):
    with tempfile.TemporaryDirectory(dir=out) as tmp:
        root = Path(tmp)
        producer = root / 'producer-한글.bin'
        producer.write_bytes(b'owned synthetic producer bytes')
        fingerprint = runtime_fingerprint(root, producer, True)
        a = root / 'python.sqlite3'
        b = root / 'rust.sqlite3'
        db = connect(a)
        if kind != 'missing-marker':
            db.execute('INSERT INTO tracker_meta VALUES(?,?)', ('tracker_runtime_fingerprint', fingerprint if kind != 'mismatch' else '0' * 64))
            db.commit()
        if kind in ['existing', 'existing-new-producer', 'bad-epoch', 'readonly-existing']:
            db.execute('BEGIN IMMEDIATE')
            python_prepare(db)
            db.commit()
        elif kind == 'partial':
            db.execute(SCHEMA['screen_context_activity_meta'])
            db.commit()
        elif kind == 'unknown':
            db.execute('CREATE TABLE screen_context_activity_extra(value TEXT)')
            db.commit()
        if kind == 'bad-epoch':
            db.execute('UPDATE screen_context_activity_meta SET epoch=?', ('X' * 32,))
            db.commit()
        db.close()
        shutil.copyfile(a, b)
        if kind == 'existing-new-producer':
            producer.write_bytes(b'changed owned synthetic producer')
        if kind == 'producer-symlink':
            alias = root / 'producer-link'
            alias.symlink_to(producer)
            producer = alias
        if kind == 'producer-missing':
            producer = root / 'missing-producer'
        if kind == 'producer-relative':
            producer = Path('relative-producer')
        if kind == 'missing-db':
            a.unlink()
            b.unlink()
        if kind == 'directory-db':
            a.unlink()
            b.unlink()
            a.mkdir()
            b.mkdir()
        if kind.startswith('readonly'):
            a.chmod(292)
            b.chmod(292)
        # A raw read/close of this inode can release the process's POSIX locks,
        # including an exclusive lock held by another SQLite connection. Hash
        # before acquiring locks so the native child sees the real busy writer.
        before_hash_a = hashlib.sha256(a.read_bytes()).hexdigest() if a.is_file() else None
        before_hash_b = hashlib.sha256(b.read_bytes()).hexdigest() if b.is_file() else None
        locks = []
        if kind == 'locked':
            for p in [a, b]:
                lock = sqlite3.connect(p)
                lock.execute('BEGIN EXCLUSIVE')
                locks.append(lock)
        try:
            (expected_code, expected) = oracle(a, producer)
            start = time.monotonic()
            result = subprocess.run([str(exe), 'screen-context-activity-prepare-v1', '--db', str(b), '--producer-runtime', str(producer)], capture_output=True, timeout=2)
        finally:
            for lock in locks:
                lock.rollback()
                lock.close()
        same = result.returncode == expected_code and result.stdout == expected and (result.stderr == b'')
        if a.is_file() and b.is_file():
            same = same and snapshot(a) == snapshot(b)
        else:
            same = same and a.is_file() == b.is_file() and (a.is_dir() == b.is_dir())
        state = expected[-1] if expected.startswith(b'SBP1') and len(expected) == 5 else None
        if state != 0 or kind in ['existing', 'existing-new-producer', 'readonly-existing']:
            if a.is_file():
                same = same and hashlib.sha256(a.read_bytes()).hexdigest() == before_hash_a
            if b.is_file():
                same = same and hashlib.sha256(b.read_bytes()).hexdigest() == before_hash_b
        cases.append({'case': name, 'passed': same, 'state': state, 'expectedExit': expected_code, 'actualExit': result.returncode, 'stderrBytes': len(result.stderr), 'expectedOutputBytes': len(expected), 'actualOutputBytes': len(result.stdout), 'normalizedDatabaseStatesMatch': same, 'elapsedMs': (time.monotonic() - start) * 1000})
        if not same:
            failed = out / 'prepare-failure-v3'
            failed.mkdir(exist_ok=True)
            if a.is_file():
                shutil.copyfile(a, failed / (name + '-python.sqlite3'))
            if b.is_file():
                shutil.copyfile(b, failed / (name + '-rust.sqlite3'))
            actual_state = result.stdout[-1] if result.stdout.startswith(b'SBP1') and len(result.stdout) == 5 else None
            raise AssertionError(f'Preparation parity mismatch {name}: expected state {state}, actual {actual_state}, exit {result.returncode}')
try:
    for kind in ['new', 'missing-marker', 'mismatch', 'existing', 'existing-new-producer', 'partial', 'unknown', 'bad-epoch', 'missing-db', 'directory-db', 'producer-symlink', 'producer-missing', 'producer-relative', 'readonly-new', 'readonly-existing', 'locked']:
        one(kind, kind)
    for (i, args) in enumerate([['serve'], ['screen-context-activity-prepare-v1', '--db', '/synthetic-missing'], ['screen-context-activity-prepare-v1', '--db', '/synthetic-missing', '--producer-runtime', '/synthetic-missing', 'extra']]):
        (code, expected) = oracle(Path('/unused'), Path('/unused'), args)
        actual = subprocess.run([str(exe), *args], capture_output=True, timeout=2)
        same = actual.returncode == code and actual.stdout == expected and (actual.stderr == b'')
        cases.append({'case': 'invalid-cli-' + str(i), 'passed': same})
        assert same
    with tempfile.TemporaryDirectory(dir=out) as tmp:
        root = Path(tmp)
        producer = root / 'producer'
        producer.write_bytes(b'owned concurrent producer')
        path = root / 'concurrent.sqlite3'
        db = connect(path)
        db.execute('INSERT INTO tracker_meta VALUES(?,?)', ('tracker_runtime_fingerprint', runtime_fingerprint(root, producer, True)))
        db.commit()
        before = db.execute('SELECT * FROM activity_segments').fetchall()
        db.close()
        command = [str(exe), 'screen-context-activity-prepare-v1', '--db', str(path), '--producer-runtime', str(producer)]
        processes = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
        try:
            results = [(process, process.communicate(timeout=2)) for process in processes]
        finally:
            for process in processes:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=2)
        assert all((process.returncode == 0 and stdout in (b'SBP1\x00', b'SBP1\x03') and (not stderr) for (process, (stdout, stderr)) in results))
        assert any((stdout == b'SBP1\x00' for (_, (stdout, _)) in results))
        with sqlite3.connect(path) as db:
            epoch = read_state(db, ()).epoch
            assert db.execute('SELECT * FROM activity_segments').fetchall() == before
        followup = subprocess.run(command, capture_output=True, timeout=2)
        assert (followup.returncode, followup.stdout, followup.stderr) == (0, b'SBP1\x00', b'')
        with sqlite3.connect(path) as db:
            assert read_state(db, ()).epoch == epoch
        cases.append({'case': 'concurrent-preparers-keep-one-valid-epoch', 'passed': True})
    summary = {'passed': True, 'count': len(cases), 'cases': cases, 'fixedSBP1AndExitParity': True, 'knownSchemaAndActivityRowsAndTrackerMarkerCompared': True, 'epochsIndependentlyRandom32LowerHexValidated': True, 'unchangedStatesCheckedByteForByte': True, 'noProductSourceDataOrSchemaChanged': True, 'notProNativeOrAppAcceptance': True}
except Exception as error:
    summary = {'passed': False, 'count': len(cases), 'cases': cases, 'error': type(error).__name__ + ': ' + str(error)}
    report.write_text(json.dumps(summary, indent=2) + '\n')
    raise
report.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'passed': True, 'cases': len(cases), 'maxRoundTripMs': max((r.get('elapsedMs', 0) for r in cases))}))
