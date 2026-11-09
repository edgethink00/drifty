// Exact-image OCR bridge. No OS capture, URL, filesystem target, model,
// account, network or provider input. Parent owns the frame and cancellation.
import Foundation
import AppKit
import Vision
import ImageIO
import CryptoKit

struct SceneOCRRegion: Codable {
    let x: UInt32, y: UInt32, width: UInt32, height: UInt32
}
struct SceneOCRInput: Decodable {
    let protocolVersion: Int
    let requestId: UUID
    let imageSha256: String
    let region: SceneOCRRegion
    let width: UInt32
    let height: UInt32
    let pngBytes: Int
}
func sceneReadExact(_ count: Int) throws -> Data {
    guard count > 0, count <= 2 * 1024 * 1024 else { throw Failure.arguments }
    var data = Data()
    while data.count < count {
        guard let part = try FileHandle.standardInput.read(upToCount: count - data.count), !part.isEmpty else { throw Failure.changed }
        data.append(part)
    }
    return data
}
func sceneOCRRequest() -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = true
    request.recognitionLanguages = ["en-US", "ko-KR"]
    return request
}
func sceneOCRWarmup() throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 625, pixelsHigh: 620,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 2500, bitsPerPixel: 32),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else { throw Failure.unavailable }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.white.setFill(); NSRect(x: 0, y: 0, width: 625, height: 620).fill()
    ("Drifty prepared OCR" as NSString).draw(in: NSRect(x: 30, y: 50, width: 560, height: 540),
        withAttributes: [.font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.black])
    NSGraphicsContext.restoreGraphicsState()
    guard let image = bitmap.cgImage else { throw Failure.unavailable }
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([sceneOCRRequest()])
}
func sceneOCR(onHeaderRead: () -> Void, onImageRead: () -> Void) throws {
    let prefix = try sceneReadExact(4)
    let length = prefix.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    guard length > 0, length <= 16 * 1024 else { throw Failure.arguments }
    let header = try sceneReadExact(Int(length))
    let value = try JSONDecoder().decode(SceneOCRInput.self, from: header)
    onHeaderRead()
    guard value.protocolVersion == 2,
          (1...2 * 1024 * 1024).contains(value.pngBytes), value.width > 0, value.height > 0,
          value.width <= 1920, value.height <= 1920,
          value.region.width > 0, value.region.height > 0,
          UInt64(value.region.x) + UInt64(value.region.width) <= UInt64(value.width),
          UInt64(value.region.y) + UInt64(value.region.height) <= UInt64(value.height) else { throw Failure.arguments }
    var pixels = try sceneReadExact(value.pngBytes)
    defer { pixels.resetBytes(in: 0..<pixels.count) }
    guard SHA256.hash(data: pixels).map({ String(format: "%02x", $0) }).joined() == value.imageSha256,
          let source = CGImageSourceCreateWithData(pixels as CFData, nil),
          CGImageSourceGetType(source) as String? == "public.png", CGImageSourceGetCount(source) == 1,
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          image.width == Int(value.width), image.height == Int(value.height) else { throw Failure.changed }
    onImageRead()
    let ocr = sceneOCRRequest()
    let r = value.region, w = Double(value.width), h = Double(value.height)
    ocr.regionOfInterest = CGRect(x: Double(r.x)/w, y: 1-(Double(r.y)+Double(r.height))/h,
                                  width: Double(r.width)/w, height: Double(r.height)/h)
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([ocr])
    var text = String((ocr.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n").prefix(2000))
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { text = "" }
    try scenePacket(["protocolVersion": 2, "requestId": value.requestId.uuidString, "imageSha256": value.imageSha256,
        "region": ["x": r.x, "y": r.y, "width": r.width, "height": r.height],
        "textEvidence": ["source": "ocr", "state": text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "no_text" : "recognized", "text": text]])
}

// Four images at most; no screen access or account state in this worker.
// Each image's objects leave their autorelease pool before readiness is sent.
func sceneOCRWorker() throws {
    signal(SIGALRM) { _ in _exit(4) }
    sceneOCRWatchdog(5000)
    try autoreleasepool { try sceneOCRWarmup() }
    for _ in 0..<4 {
        sceneOCRWatchdog(60_000)
        try FileHandle.standardOutput.write(contentsOf: Data("SOCR2".utf8))
        try autoreleasepool {
            try sceneOCR(onHeaderRead: { sceneOCRWatchdog(3000) }, onImageRead: { sceneOCRWatchdog(1100) })
        }
    }
    try FileHandle.standardOutput.write(contentsOf: Data("SOCR2".utf8))
}

private func sceneOCRWatchdog(_ milliseconds: Int) {
    var timer = itimerval(it_interval: timeval(tv_sec: 0, tv_usec: 0),
                         it_value: timeval(tv_sec: milliseconds / 1000, tv_usec: Int32((milliseconds % 1000) * 1000)))
    guard setitimer(ITIMER_REAL, &timer, nil) == 0 else { _exit(4) }
}
