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

var approval = healthy
let runId = "run_1be34a56-7c98-4d32-8286-3d889dc6124f"
approval["openRouterApproval"] = ["runId": runId, "texts": 7]
guard case .textReview(texts: 7)? = ProxyHealthSnapshot.decode(data(approval), statusCode: 200)?.openRouterApproval?.contents else {
    fatalError("Legacy UX Writer approval was lost")
}
approval["openRouterApproval"] = ["runId": runId, "kind": "task-passport", "screens": 2]
guard case .taskPassport(screens: 2)? = ProxyHealthSnapshot.decode(data(approval), statusCode: 200)?.openRouterApproval?.contents else {
    fatalError("Task Passport approval was lost")
}
approval["openRouterApproval"] = ["runId": runId, "kind": "task-passport", "screens": 25, "texts": 7]
precondition(ProxyHealthSnapshot.decode(data(approval), statusCode: 200)?.openRouterApproval == nil)
print("Proxy health regression cases PASS")
