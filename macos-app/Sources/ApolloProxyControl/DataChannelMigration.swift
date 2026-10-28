import Foundation

enum DataChannelMigration {
    static func replacement(configured: String?, bundled: String?, previousRuntimeIDs: [String]) -> String? {
        guard let bundled, URL(string: bundled)?.scheme == "https", configured != bundled else { return nil }
        let prefix = "https://raw.githubusercontent.com/Ackedze/design-system_ab/main/"
        var defaults: Set<String> = [prefix + "apollo/data-packages/current.json",
                                     prefix + "apollo/channels/stable/data-packages/current.json"]
        for id in previousRuntimeIDs where id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil {
            defaults.insert(prefix + "apollo/runtimes/" + id + "/data-packages/current.json")
        }
        guard configured == nil || configured == "" || defaults.contains(configured!) else { return nil }
        return bundled
    }
}
