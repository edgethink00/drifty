#!/usr/bin/env python3
"""Exercise the actual Dock clipping geometry with synthetic rectangles; no desktop access."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--artifacts', type=Path, required=True)
args = parser.parse_args()
args.artifacts.mkdir(parents=True, mode=0o700)
source = (Path(__file__).parents[1] / 'macos.swift').read_text()
start = source.index('func clearOfDock(')
code = source[start:source.index('\n}\n', start) + 3]
driver = r'''
func check(_ name: String, _ got: CGRect?, _ want: CGRect?) {
    guard got == want else { print("FAIL \(name): \(String(describing: got)) != \(String(describing: want))"); exit(1) }
}
let window = CGRect(x: 12, y: 25, width: 1000, height: 690)
// Bottom Dock reaching a few points into a near-full window: keep everything above it.
check("bottom", clearOfDock(window, dock: CGRect(x: 230, y: 711.5, width: 560, height: 57)),
      CGRect(x: 12, y: 25, width: 1000, height: 686))
// Left and right Docks keep the far side.
check("left", clearOfDock(window, dock: CGRect(x: 0, y: 120, width: 60.4, height: 500)),
      CGRect(x: 61, y: 25, width: 951, height: 690))
check("right", clearOfDock(window, dock: CGRect(x: 960.6, y: 120, width: 64, height: 500)),
      CGRect(x: 12, y: 25, width: 948, height: 690))
// A Dock inside the window, or covering more than half of it, still refuses.
check("inside", clearOfDock(window, dock: CGRect(x: 300, y: 300, width: 100, height: 100)), nil)
check("most", clearOfDock(window, dock: CGRect(x: 0, y: 200, width: 1024, height: 568)), nil)
print("ok")
'''
program = args.artifacts / 'dock_clip.swift'
program.write_text('import CoreGraphics\nimport Foundation\n' + code + driver)
binary = args.artifacts / 'dock_clip'
subprocess.run(['xcrun', 'swiftc', '-O', str(program), '-o', str(binary)], check=True)
result = subprocess.run([str(binary)], capture_output=True, text=True)
print(result.stdout, end='')
raise SystemExit(result.returncode)

