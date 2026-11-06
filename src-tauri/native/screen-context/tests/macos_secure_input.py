#!/usr/bin/env python3
"""Exercise the actual secure-input traversal with synthetic AX responses; no desktop access."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--artifacts', type=Path, required=True)
args = parser.parse_args()
args.artifacts.mkdir(parents=True, mode=0o700)
source = (Path(__file__).parents[1] / 'macos.swift').read_text()
code = source[source.index('func secureInputChildren('):source.index('\n@MainActor func inspect')]
driver = r'''
import Foundation
import ApplicationServices
enum Refusal: Error { case unavailable }
struct Node {
    var role: AnyObject = kAXGroupRole as NSString
    var children: AnyObject = [] as NSArray
    var status: AXError = .success
    var subrole: String? = nil
    var subroleStatus: AXError = .attributeUnsupported
}
var nodes: [CFHashCode: Node] = [:]
var reads = 0
func element(_ id: Int) -> AXUIElement { AXUIElementCreateApplication(pid_t(id)) }
func errorValue(_ error: AXError) -> AXValue {
    var error = error
    return AXValueCreate(.axError, &error)!
}
// Shadow the imported transport, keeping the production traversal and CF decoder.
func AXUIElementCopyMultipleAttributeValues(_ e: AXUIElement, _ attrs: CFArray,
    _ options: AXCopyMultipleAttributeOptions, _ out: UnsafeMutablePointer<CFArray?>) -> AXError {
    precondition((attrs as! [String]) == [kAXRoleAttribute, kAXChildrenAttribute])
    precondition(options.isEmpty)
    reads += 1
    guard let node = nodes[CFHash(e)] else { return .invalidUIElement }
    out.pointee = [node.role, node.children] as CFArray
    return node.status
}
func AXUIElementCopyAttributeValue(_ e: AXUIElement, _ attr: CFString,
    _ out: UnsafeMutablePointer<CFTypeRef?>) -> AXError {
    precondition(attr as String == kAXSubroleAttribute)
    guard let node = nodes[CFHash(e)] else { return .invalidUIElement }
    out.pointee = node.subrole as CFTypeRef?
    return node.subroleStatus
}
''' + code + r'''
func check(_ condition: @autoclosure () throws -> Bool) throws {
    guard try condition() else { fatalError("secure-input assertion failed") }
}
func refused(_ operation: () throws -> Void) {
    do { try operation(); fatalError("expected fail-closed refusal") }
    catch Refusal.unavailable {} catch { fatalError("unexpected failure") }
}
@main struct Tests {
    static func main() throws {
        for status in [AXError.noValue, .attributeUnsupported] {
            try check(secureInputChildren(errorValue(status)).isEmpty)
        }
        for status in [AXError.cannotComplete, .invalidUIElement, .failure, .success] {
            refused { _ = try secureInputChildren(errorValue(status)) }
        }
        for value: AnyObject in [NSNull(), "bad" as NSString, ["bad"] as NSArray] {
            refused { _ = try secureInputChildren(value) }
        }
        nodes = [CFHash(element(1)): Node(children: [element(2)] as NSArray),
                 CFHash(element(2)): Node(role: kAXTextFieldRole as NSString,
                    children: errorValue(.noValue), subrole: kAXSecureTextFieldSubrole, subroleStatus: .success)]
        try check(hasSecureInput(element(1)))
        nodes[CFHash(element(2))]!.subrole = nil
        nodes[CFHash(element(2))]!.subroleStatus = .attributeUnsupported
        try check(!hasSecureInput(element(1)))
        nodes[CFHash(element(2))]!.subroleStatus = .cannotComplete
        refused { _ = try hasSecureInput(element(1)) }
        nodes[CFHash(element(2))]!.status = .cannotComplete
        refused { _ = try hasSecureInput(element(1)) }
        nodes[CFHash(element(2))] = Node(role: errorValue(.noValue))
        refused { _ = try hasSecureInput(element(1)) }
        nodes.removeAll()
        for i in 1...4096 { nodes[CFHash(element(i))] = Node(children: i == 4096 ? [] as NSArray : [element(i+1)] as NSArray) }
        reads = 0
        try check(!hasSecureInput(element(1)))
        try check(reads == 4096)
        nodes[CFHash(element(4096))]!.children = [element(4097)] as NSArray
        refused { _ = try hasSecureInput(element(1)) }
        nodes = [CFHash(element(1)): Node(children: [element(1)] as NSArray)]
        refused { _ = try hasSecureInput(element(1)) }
        nodes = [CFHash(element(1)): Node(children: Array(repeating: element(2), count: 4096) as NSArray)]
        refused { _ = try hasSecureInput(element(1)) }
        print("PASS: secure descendant, missing children, malformed/error responses, exact node limit, overflow and cycles")
    }
}
'''
p = args.artifacts / 'driver.swift'
p.write_text(driver)
binary = args.artifacts / 'driver'
result = subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-O', str(p), '-o', str(binary)], capture_output=True, text=True, timeout=120)
(args.artifacts / 'compile.log').write_text(result.stdout + result.stderr)
assert result.returncode == 0, 'Swift compile failed; inspect compile.log'
result = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
(args.artifacts / 'result.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(source.encode()).hexdigest(), 'exit': result.returncode, 'output': result.stdout, 'error': result.stderr}, indent=2))
assert result.returncode == 0, 'Secure-input checks failed; inspect result.json'
print(result.stdout, end='')
