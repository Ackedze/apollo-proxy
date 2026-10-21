import Foundation

func data(_ object: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: object) }
let proxy = ["name": "apollo-proxy", "version": "1.3.1"]
let healthy: [String: Any] = ["ok": true, "proxy": proxy, "activeRequests": 0,
    "codex": ["knowledge": ["ready": true]],
    "knowledgeRelease": ["contentVersion": "pinned-version", "sourceCommits": ["design-system_ab": "commit"]]]
let snapshot = ProxyHealthSnapshot.decode(data(healthy), statusCode: 200)!
precondition(!snapshot.busy && snapshot.activeRequests == 0 && snapshot.knowledgeReady == true)
precondition(snapshot.knowledgeVersion == "pinned-version" && snapshot.sourceCommits?["design-system_ab"] == "commit")
precondition(ProxyHealthSnapshot.decode(nil, statusCode: 200) == nil)
precondition(ProxyHealthSnapshot.decode(Data("bad JSON".utf8), statusCode: 200) == nil)
precondition(ProxyHealthSnapshot.decode(data(healthy), statusCode: 500) == nil)
precondition(ProxyHealthSnapshot.decode(data(["ok": true]), statusCode: 200) == nil)
precondition(ProxyHealthSnapshot.decode(data(["ok": true, "proxy": ["name": "other-service"]]), statusCode: 200) == nil)
precondition(ProxyHealthSnapshot.decode(data(["ok": false, "proxy": proxy]), statusCode: 200) == nil)
for field in ["agent", "codex", "generation"] {
    var busy = healthy; busy[field] = ["busy": true]
    precondition(ProxyHealthSnapshot.decode(data(busy), statusCode: 200)!.busy)
}
var active = healthy; active["activeRequests"] = 1
precondition(ProxyHealthSnapshot.decode(data(active), statusCode: 200)!.busy)
var missingKnowledge = healthy; missingKnowledge["codex"] = ["knowledge": ["ready": false]]
precondition(ProxyHealthSnapshot.decode(data(missingKnowledge), statusCode: 200)!.knowledgeReady == false)
print("Proxy health regression cases PASS")
