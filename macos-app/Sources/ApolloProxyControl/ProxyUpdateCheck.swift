import Foundation

// The CLI runners share locks and must finish one check before starting the other.
@MainActor
final class ProxyUpdateCheck {
    typealias Step = (@escaping @MainActor () -> Void) -> Void
    private(set) var isRunning = false

    func run(code: Step, knowledge: @escaping Step, completion: @escaping @MainActor () -> Void) {
        guard !isRunning else { return }
        isRunning = true
        code {
            knowledge {
                self.isRunning = false
                completion()
            }
        }
    }
}
