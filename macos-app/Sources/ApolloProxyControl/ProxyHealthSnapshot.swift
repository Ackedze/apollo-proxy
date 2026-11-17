import Foundation

struct ProxyHealthSnapshot: Sendable {
    let activeRequests: Int
    let busy: Bool
    let knowledgeReady: Bool?
    let knowledgeVersion: String?
    let sourceCommits: [String: String]?
    let supervisorPID: Int?
    let openRouterEnabled: Bool
    let openRouterApproval: OpenRouterApproval?
    let openRouterFailure: OpenRouterFailure?

    struct OpenRouterApproval: Sendable {
        let runId: String
        let texts: Int
    }
    struct OpenRouterFailure: Sendable {
        let runId: String
        let code: String
    }

    static func decode(_ data: Data?, statusCode: Int?) -> ProxyHealthSnapshot? {
        guard statusCode == 200, let data,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["ok"] as? Bool == true,
              let proxy = json["proxy"] as? [String: Any],
              proxy["name"] as? String == "apollo-proxy" else { return nil }
        let agent = json["agent"] as? [String: Any]
        let codex = json["codex"] as? [String: Any]
        let generation = json["generation"] as? [String: Any]
        let knowledge = codex?["knowledge"] as? [String: Any]
        let release = json["knowledgeRelease"] as? [String: Any]
        let activeRequests = json["activeRequests"] as? Int ?? 0
        let approval = json["openRouterApproval"] as? [String: Any]
        let approvalRequest: OpenRouterApproval?
        if let runId = approval?["runId"] as? String, let texts = approval?["texts"] as? Int, texts > 0,
           runId.hasPrefix("run_"), UUID(uuidString: String(runId.dropFirst(4))) != nil {
            approvalRequest = OpenRouterApproval(runId: runId, texts: texts)
        } else {
            approvalRequest = nil
        }
        let failure = json["openRouterFailure"] as? [String: Any]
        let openRouterFailure = (failure?["runId"] as? String).flatMap { runId in
            (failure?["code"] as? String).map { OpenRouterFailure(runId: runId, code: $0) }
        }
        return ProxyHealthSnapshot(
            activeRequests: activeRequests,
            busy: activeRequests > 0 || agent?["busy"] as? Bool == true
                || codex?["busy"] as? Bool == true || generation?["busy"] as? Bool == true,
            knowledgeReady: knowledge?["ready"] as? Bool,
            knowledgeVersion: release?["contentVersion"] as? String,
            sourceCommits: release?["sourceCommits"] as? [String: String],
            supervisorPID: proxy["codeSupervisorPid"] as? Int,
            openRouterEnabled: json["openRouterEnabled"] as? Bool == true,
            openRouterApproval: approvalRequest,
            openRouterFailure: openRouterFailure
        )
    }
}
