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
    targets: [
        .executableTarget(
            name: "ApolloProxyControl",
            path: "Sources/ApolloProxyControl"
        )
    ]
)
