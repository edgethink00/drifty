// swift-tools-version: 5.10
// Vendored subset of jaywcjlove/PermissionFlow v2.11.4 (MIT, see LICENSE).
// Only the two modules Drifty's permission guide uses are kept; the upstream
// manifest's optional status-provider products are omitted.

import PackageDescription

let package = Package(
    name: "PermissionFlow",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "PermissionFlow", targets: ["PermissionFlow"])
    ],
    targets: [
        .target(name: "SystemSettingsKit"),
        .target(
            name: "PermissionFlow",
            dependencies: ["SystemSettingsKit"],
            resources: [.process("Resources")]
        )
    ]
)
