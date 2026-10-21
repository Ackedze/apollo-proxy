import Foundation

struct ProxyHealthSnapshot: Sendable {
    let activeRequests: Int
    let busy: Bool
    let knowledgeReady: Bool?
    let knowledgeVersion: String?
    let sourceCommits: [String: String]?

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
        return ProxyHealthSnapshot(
            activeRequests: activeRequests,
            busy: activeRequests > 0 || agent?["busy"] as? Bool == true
                || codex?["busy"] as? Bool == true || generation?["busy"] as? Bool == true,
            knowledgeReady: knowledge?["ready"] as? Bool,
            knowledgeVersion: release?["contentVersion"] as? String,
            sourceCommits: release?["sourceCommits"] as? [String: String]
        )
    }
}
