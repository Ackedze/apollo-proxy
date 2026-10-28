import Foundation
import Security

let service = "Apollo Proxy Data Publisher"
let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"corporate-password"]
func read() throws -> Data? {
    var q=query; q[kSecReturnData as String]=true
    var value: CFTypeRef?
    let result=SecItemCopyMatching(q as CFDictionary,&value)
    if result==errSecItemNotFound { return nil }
    guard result==errSecSuccess else { throw NSError(domain:"ApolloDataPublisher",code:Int(result)) }
    return value as? Data
}
do {
    switch CommandLine.arguments.dropFirst().first {
    case "init":
        if try read()==nil {
            var random=Data(count:24)
            let result=random.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault,24,$0.baseAddress!) }
            guard result==errSecSuccess else { throw NSError(domain:"ApolloDataPublisher",code:Int(result)) }
            let password=random.base64EncodedString()
            var item=query; item[kSecValueData as String]=Data(password.utf8)
            item[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary,nil)==errSecSuccess else { throw NSError(domain:"ApolloDataPublisher",code:1) }
        }
        print("Corporate password is stored in macOS Keychain: Apollo Proxy Data Publisher / corporate-password")
    case "password":
        guard let value=try read(),let password=String(data:value,encoding:.utf8) else { throw NSError(domain:"ApolloDataPublisher",code:2) }
        // This output is consumed only by the package builder's private stdin pipe.
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:["password":password]))
    default: throw NSError(domain:"ApolloDataPublisher",code:3)
    }
} catch {
    FileHandle.standardError.write(Data("DATA_PUBLISHER_KEYCHAIN_FAILED\n".utf8));exit(1)
}
