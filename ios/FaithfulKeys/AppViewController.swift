import UIKit
import WebKit
import AVFAudio
import CoreAudioKit

final class AppViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private let midi = MIDIService()
    private var saveInProgress = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let root = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
        configuration.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: "faithful-keys")
        if let scriptURL = Bundle.main.url(forResource: "midi-bridge", withExtension: "js"),
           let source = try? String(contentsOf: scriptURL, encoding: .utf8) {
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        configuration.userContentController.add(self, name: "faithfulKeys")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = .systemBackground
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
        ])
        midi.send = { [weak self] payload in self?.send(payload) }
        NotificationCenter.default.addObserver(self, selector: #selector(suspend), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resume), name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        activateAudio()
        web.load(URLRequest(url: URL(string: "faithful-keys://app/index.html")!))
    }

    private func activateAudio() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setPreferredIOBufferDuration(0.005)
            try session.setActive(true)
        } catch { NSLog("Faithful Keys audio: %@", error.localizedDescription) }
    }
    @objc private func suspend() { midi.suspend() }
    @objc private func resume() { activateAudio(); midi.resume() }
    @objc private func interrupted(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began { midi.suspend() }
        else { resume() }
    }
    private func send(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let text = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__faithfulKeysReceive?.(\(text))", completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "faithful-keys",
              message.frameInfo.securityOrigin.host == "app",
              web.url?.scheme == "faithful-keys", web.url?.host == "app",
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "start":
            guard let id = body["id"] as? Int, id > 0 else { return }
            activateAudio(); midi.start(id: id)
        case "stop": midi.stop()
        case "bluetooth":
            guard presentedViewController == nil else { return }
            let picker = CABTMIDICentralViewController()
            picker.title = "Bluetooth keyboards"
            picker.navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closePicker))
            let navigation = UINavigationController(rootViewController: picker)
            present(navigation, animated: true)
        case "save": save(body)
        default: break
        }
    }
    @objc private func closePicker() { dismiss(animated: true) }

    private func save(_ body: [String: Any]) {
        guard !saveInProgress, presentedViewController == nil,
              let text = body["text"] as? String, let data = text.data(using: .utf8), data.count <= 2 * 1024 * 1024,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["format"] as? String == "faithful-keys-progression" else {
            send(["type": "saved", "error": "Close the current sheet and try saving a valid progression."]); return
        }
        let proposed = (body["name"] as? String ?? "faithful-keys-progression.json")
        let safeName = String(proposed.filter { $0.isLetter || $0.isNumber || "-_.".contains($0) }.prefix(100))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = directory.appendingPathComponent(safeName.hasSuffix(".json") ? safeName : "faithful-keys-progression.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
            saveInProgress = true
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            share.popoverPresentationController?.sourceView = view
            share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            share.completionWithItemsHandler = { [weak self] _, completed, _, error in
                self?.saveInProgress = false
                if let error { self?.send(["type": "saved", "error": error.localizedDescription]) }
                else { self?.send(["type": "saved", "completed": completed]) }
                try? FileManager.default.removeItem(at: directory)
            }
            present(share, animated: true)
        } catch { send(["type": "saved", "error": error.localizedDescription]) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false {
            // Embedded online content gets no bridge; never navigate the privileged main frame to it.
            decisionHandler(url.scheme == "https" || url.scheme == "about" ? .allow : .cancel); return
        }
        if url.scheme == "faithful-keys", url.host == "app" { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if action.navigationType == .linkActivated && ["https", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["https", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        return nil
    }
    #if DEBUG
    // Exercise WebKit's actual custom-origin storage and audio decoding in the
    // simulator. This hook and its status label do not exist in Release builds.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard ProcessInfo.processInfo.arguments.contains("--runtime-check") else { return }
        let reset = ProcessInfo.processInfo.arguments.contains("--reset-runtime-check")
        let script = """
        const key = '__faithful_keys_ios_test';
        if (reset) localStorage.removeItem(key);
        const state = localStorage.getItem(key) === 'saved' ? 'restored' : 'fresh';
        localStorage.setItem(key, 'saved');
        const context = new AudioContext();
        try {
            const response = await fetch('faithful-keys://app/audio/grand/Mp%20A4.m4a');
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            if (buffer.duration <= 0) throw new Error('Empty piano sample');
            if (typeof crypto.randomUUID !== 'function') throw new Error('UUID unavailable');
            return 'Runtime check: ' + state + ', audio OK, UUID OK';
        } finally { await context.close(); }
        """
        webView.callAsyncJavaScript(script, arguments: ["reset": reset], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            let label = UILabel(frame: CGRect(x: 0, y: self.view.bounds.height - 25, width: self.view.bounds.width, height: 20))
            label.accessibilityIdentifier = "runtime-check"
            label.font = .systemFont(ofSize: 9)
            switch result {
            case .success(let value): label.text = value as? String
            case .failure(let error): label.text = "Runtime check failed: " + error.localizedDescription
            }
            self.view.addSubview(label)
        }
    }
    #endif

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        midi.stop(); webView.reload()
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Faithful Keys", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Faithful Keys", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Continue", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}
