// swift-tools-version: 5.10
// Drifty's permission guide helper. See README.md.

import PackageDescription

let package = Package(
    name: "DriftyPermissionGuide",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "drifty-permission-guide", targets: ["DriftyPermissionGuide"])
    ],
    dependencies: [
        .package(path: "PermissionFlow")
    ],
    targets: [
        .executableTarget(
            name: "DriftyPermissionGuide",
            dependencies: [.product(name: "PermissionFlow", package: "PermissionFlow")]
        )
    ]
)
