import Foundation

struct AppUpdateResumeIntent {
    private let defaults: UserDefaults
    private let key = "resumeManagedProxyAfterAppUpdate"

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func prepare(managedRunning: Bool) {
        defaults.set(managedRunning, forKey: key)
    }

    func cancel() { defaults.removeObject(forKey: key) }

    func consume() -> Bool {
        let resume = defaults.bool(forKey: key)
        cancel()
        return resume
    }
}

enum AppUpdateState: Equatable {
    case unconfigured, idle, checking, current, available(String), installing, failed(String)
    var summary: String {
        switch self {
        case .unconfigured: return "Канал обновлений приложения ещё не настроен"
        case .idle: return "Проверка ещё не выполнена"
        case .checking: return "Проверяем обновление приложения…"
        case .current: return "Установлена актуальная версия приложения"
        case .available(let version): return "Доступна версия \(version)"
        case .installing: return "Готовим обновление приложения…"
        case .failed(let message): return "Ошибка обновления: \(message)"
        }
    }
    var canInstall: Bool { if case .available = self { return true }; return false }
    var isBusy: Bool { self == .checking || self == .installing }
}
