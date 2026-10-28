import AppKit
import Sparkle

@MainActor
final class AppUpdater: NSObject, SPUUpdaterDelegate {
    private var controller: SPUStandardUpdaterController?
    private var completion: (() -> Void)?
    private var postponedInstall: (() -> Void)?
    private var installationCommitted = false
    private let transport = AppUpdateTransport()
    var configureTransport: (() throws -> AppUpdateTransport.Configuration)?
    var onChange: (() -> Void)?
    var canBeginInstallation: () -> Bool = { false }
    var onAbortInstallation: () -> Void = {}
    var prepareInstallation: (@escaping (Bool) -> Void) -> Void = { $0(false) }
    private(set) var state: AppUpdateState = .unconfigured { didSet { onChange?() } }
    var canCheck: Bool { controller?.updater.canCheckForUpdates == true && !state.isBusy }
    var hasSession: Bool { state == .installing || postponedInstall != nil || installationCommitted }

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
        withTransport { controller.updater.checkForUpdateInformation() }
    }
    func install() {
        guard canBeginInstallation() else { return }
        if let handler = postponedInstall { finishInstallation(handler); return }
        guard canCheck, state.canInstall else { return }
        state = .installing
        withTransport { [weak self] in self?.controller?.checkForUpdates(nil) }
    }
    private func withTransport(_ action: @escaping () -> Void) {
        do {
            guard let configureTransport else { throw NSError(domain: "ApolloAppUpdate", code: 2) }
            transport.start(try configureTransport()) { [weak self] result in
                switch result {
                case .success: action()
                case .failure(let error): self?.transportFailed(error)
                }
            }
        } catch { transportFailed(error) }
    }
    private func transportFailed(_ error: Error) {
        state = .failed(error.localizedDescription)
        let done = completion; completion = nil; done?()
        onAbortInstallation()
    }
    func feedURLString(for updater: SPUUpdater) -> String? { transport.feedURL }
    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
        if let remote = request.url { request.url = transport.archiveURL(for: remote) }
    }
    func updater(_ updater: SPUUpdater, shouldDownloadReleaseNotesForUpdate item: SUAppcastItem) -> Bool { false }
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
        else if !installationCommitted && (state == .checking || state == .installing) { state = .idle }
        let done = completion; completion = nil; done?()
        if updateCheck != .updateInformation {
            postponedInstall = nil
            if error != nil || !installationCommitted {
                installationCommitted = false
                onAbortInstallation()
            }
        }
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
    func finishInstallation(_ handler: @escaping () -> Void) {
        installationCommitted = false
        prepareInstallation { [weak self] permitted in
            guard let self else { return }
            if permitted {
                self.installationCommitted = true
                self.state = .installing
                self.postponedInstall = nil
                handler()
            } else {
                self.onAbortInstallation()
                self.state = .available("подготовлена; повторите установку после завершения задачи")
            }
        }
    }
}
