import Foundation
import Security
import CryptoKit

// A stable, free identity preserves Keychain access across application updates.
let name = "Apollo Proxy Publisher"
func existing() throws -> String? {
    let query: [String: Any] = [kSecClass as String:kSecClassIdentity,
        kSecMatchLimit as String:kSecMatchLimitAll,kSecReturnRef as String:true]
    var value: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary,&value)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw failure(status) }
    for identity in value as? [SecIdentity] ?? [] {
        var certificate: SecCertificate?
        guard SecIdentityCopyCertificate(identity,&certificate) == errSecSuccess,let certificate else { continue }
        var commonName: CFString?
        guard SecCertificateCopyCommonName(certificate,&commonName) == errSecSuccess,
              commonName as String? == name else { continue }
        return Insecure.SHA1.hash(data:SecCertificateCopyData(certificate) as Data).map { String(format:"%02X",$0) }.joined()
    }
    return nil
}
func failure(_ status: OSStatus = -1) -> Error { NSError(domain:"ApolloAppSigning",code:Int(status)) }
func run(_ arguments: [String],input: Data? = nil) throws {
    let task=Process();task.executableURL=URL(fileURLWithPath:"/usr/bin/openssl");task.arguments=arguments
    task.standardOutput=FileHandle.nullDevice;task.standardError=FileHandle.nullDevice
    let pipe=Pipe();task.standardInput=pipe
    try task.run();if let input { try pipe.fileHandleForWriting.write(contentsOf:input) }
    try pipe.fileHandleForWriting.close();task.waitUntilExit()
    guard task.terminationStatus == 0 else { throw failure() }
}
do {
    if let identity=try existing() { print(identity);exit(0) }
    let root=FileManager.default.temporaryDirectory.appendingPathComponent("apollo-signing-"+UUID().uuidString)
    try FileManager.default.createDirectory(at:root,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
    defer { try? FileManager.default.removeItem(at:root) }
    let key=root.appendingPathComponent("key.pem"),cert=root.appendingPathComponent("cert.pem"),p12=root.appendingPathComponent("identity.p12")
    let config=root.appendingPathComponent("cert.cnf")
    try "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=\(name)\n[ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n".write(to:config,atomically:true,encoding:.utf8)
    try run(["req","-new","-x509","-newkey","rsa:3072","-nodes","-days","3650","-config",config.path,"-keyout",key.path,"-out",cert.path])
    var random=Data(count:24)
    guard random.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault,24,$0.baseAddress!) }) == errSecSuccess else { throw failure() }
    let password=random.base64EncodedString()
    try run(["pkcs12","-export","-inkey",key.path,"-in",cert.path,"-name",name,"-out",p12.path,"-passout","stdin"],input:Data((password+"\n").utf8))
    var trusted: SecTrustedApplication?
    guard SecTrustedApplicationCreateFromPath("/usr/bin/codesign",&trusted) == errSecSuccess,let trusted else { throw failure() }
    var access: SecAccess?
    guard SecAccessCreate(name as CFString,[trusted] as CFArray,&access) == errSecSuccess,let access else { throw failure() }
    var keychain: SecKeychain?
    guard SecKeychainCopyDefault(&keychain) == errSecSuccess,let keychain else { throw failure() }
    let options: [String:Any] = [kSecImportExportPassphrase as String:password,
        kSecImportExportKeychain as String:keychain,kSecImportExportAccess as String:access]
    var imported: CFArray?
    guard SecPKCS12Import(try Data(contentsOf:p12) as CFData,options as CFDictionary,&imported) == errSecSuccess,
          let identity=try existing() else { throw failure() }
    print(identity)
} catch {
    FileHandle.standardError.write(Data("APP_SIGNING_KEYCHAIN_FAILED\n".utf8));exit(1)
}
