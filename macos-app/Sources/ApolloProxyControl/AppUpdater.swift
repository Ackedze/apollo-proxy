import AppKit
import Sparkle

@MainActor
final class AppUpdater: NSObject, SPUUpdaterDelegate {
    private var controller: SPUStandardUpdaterController?
    private var completion: (() -> Void)?
    private var postponedInstall: (() -> Void)?
    var onChange: (() -> Void)?
    var canBeginInstallation: () -> Bool = { false }
    var onAbortInstallation: () -> Void = {}
    var prepareInstallation: (@escaping (Bool) -> Void) -> Void = { $0(false) }
    private(set) var state: AppUpdateState = .unconfigured { didSet { onChange?() } }
    var canCheck: Bool { controller?.updater.canCheckForUpdates == true && !state.isBusy }
    var hasSession: Bool { state == .installing || postponedInstall != nil }

    override init() {
        super.init()
        guard let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String, !feed.isEmpty,
              let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
              Data(base64Encoded: key)?.count == 32 else { return }
        let controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
        self.controller = controller
        do { try controller.updater.start(); state = .idle }
        catch { state = .failed(error.localizedDescription) }
    }
    func check(completion: @escaping () -> Void) {
        guard canCheck, let controller else { completion(); return }
        self.completion = completion
        state = .checking
        controller.updater.checkForUpdateInformation()
    }
    func install() {
        guard canBeginInstallation() else { return }
        if let handler = postponedInstall { finishInstallation(handler); return }
        guard canCheck, state.canInstall else { return }
        state = .installing
        controller?.checkForUpdates(nil)
    }
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        if state != .installing { state = .available(item.displayVersionString) }
    }
    func updaterDidNotFindUpdate(_ updater: SPUUpdater) { state = .current }
    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        if let error {
            let failure = error as NSError
            if failure.domain == SUSparkleErrorDomain && failure.code == SUError.noUpdateError.rawValue { state = .current }
            else { state = .failed(error.localizedDescription) }
        }
        else if state == .checking || state == .installing { state = .idle }
        let done = completion; completion = nil; done?()
        if updateCheck != .updateInformation { postponedInstall = nil; onAbortInstallation() }
    }
    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        if updateCheck != .updateInformation && !canBeginInstallation() {
            throw NSError(domain: "ApolloAppUpdate", code: 1, userInfo: [NSLocalizedDescriptionKey: "Прокси занят. Завершите текущую задачу и повторите обновление."])
        }
    }
    func updater(_ updater: SPUUpdater, shouldPostponeRelaunchForUpdate item: SUAppcastItem, untilInvokingBlock installHandler: @escaping () -> Void) -> Bool {
        postponedInstall = installHandler
        finishInstallation(installHandler)
        return true
    }
    private func finishInstallation(_ handler: @escaping () -> Void) {
        prepareInstallation { [weak self] permitted in
            guard let self else { return }
            if permitted { self.postponedInstall = nil; handler() }
            else { self.state = .available("подготовлена; повторите установку после завершения задачи") }
        }
    }
}
