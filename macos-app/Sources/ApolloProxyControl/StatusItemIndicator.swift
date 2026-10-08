import AppKit

@MainActor
final class StatusItemIndicator {
    enum Mode {
        case hidden
        case active
        case updateAvailable
        case busy
        case error
    }

    private final class ProgressIndicator: NSProgressIndicator {
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }

    private let spinner = ProgressIndicator(frame: NSRect(x: 0, y: 0, width: 12, height: 12))
    private(set) var mode: Mode = .hidden
    private static let activeDot = dot(color: .systemGreen)
    private static let updateDot = dot(color: .systemYellow)
    private static let errorDot = dot(color: .systemRed)
    private static let spinnerPlaceholder = NSImage(size: NSSize(width: 12, height: 12), flipped: false) { _ in true }

    init() {
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isIndeterminate = true
        spinner.isDisplayedWhenStopped = false
        spinner.isHidden = true
        spinner.setAccessibilityElement(false)
        spinner.autoresizingMask = [.minXMargin, .minYMargin, .maxYMargin]
    }

    func apply(to button: NSButton, mode nextMode: Mode, description: String) {
        button.toolTip = description
        button.setAccessibilityLabel("Apollo Proxy. \(description)")
        if nextMode != .busy {
            if mode == .busy { spinner.stopAnimation(nil) }
            spinner.isHidden = true
        }
        switch nextMode {
        case .hidden:
            button.image = nil
            button.imagePosition = .noImage
        case .active:
            button.image = Self.activeDot
            button.imagePosition = .imageRight
        case .updateAvailable:
            button.image = Self.updateDot
            button.imagePosition = .imageRight
        case .error:
            button.image = Self.errorDot
            button.imagePosition = .imageRight
        case .busy:
            button.image = Self.spinnerPlaceholder
            button.imagePosition = .imageRight
            let isNewButton = spinner.superview !== button
            if isNewButton {
                spinner.removeFromSuperview()
                button.addSubview(spinner)
            }
            let imageRect = button.cell?.imageRect(forBounds: button.bounds) ?? button.bounds
            spinner.frame = NSRect(x: imageRect.midX - 6, y: imageRect.midY - 6, width: 12, height: 12)
            spinner.isHidden = false
            if mode != .busy || isNewButton { spinner.startAnimation(nil) }
        }
        mode = nextMode
    }

    private static func dot(color: NSColor) -> NSImage {
        NSImage(size: NSSize(width: 12, height: 12), flipped: false) { _ in
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: 3, y: 3, width: 6, height: 6)).fill()
            return true
        }
    }
}
