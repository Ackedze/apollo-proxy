// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "ApolloProxyControl",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "ApolloProxyControl",
            targets: ["ApolloProxyControl"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")
    ],
    targets: [
        .executableTarget(
            name: "ApolloProxyControl",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")],
            path: "Sources/ApolloProxyControl",
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        )
    ]
)
