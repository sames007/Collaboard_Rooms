(() => {
    const app = window.Collaboard = window.Collaboard || {};
    const dropdownPanel = document.getElementById("dropdownPanel");
    const resizeHandle = document.getElementById("panelResizeHandle");
    const backgroundMenu = document.getElementById("backgroundMenu");
    const backgroundButton = document.getElementById("virtualBackgroundButton");
    const appToast = document.getElementById("appToast");

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    let toastTimer = 0;

    bindClick("menuToggle", toggleDropdownPanel);
    bindClick("chatTab", () => showPanel("chat"));
    bindClick("whiteboardTab", () => showPanel("whiteboard"));
    bindClick("muteButton", () => app.toggleMute());
    bindClick("cameraButton", () => app.toggleCamera());
    bindClick("screenShareButton", () => app.toggleScreenShare());
    bindClick("virtualBackgroundButton", toggleBackgroundMenu);
    bindClick("raiseHandButton", () => app.raiseHand());
    bindClick("recordButton", () => app.toggleRecording());
    applyFeatureSupport();

    document.querySelectorAll("[data-background-effect]").forEach(option => {
        option.addEventListener("click", async event => {
            event.preventDefault();
            closeBackgroundMenu();
            await app.setVideoEffect?.(option.dataset.backgroundEffect || "none");
        });
    });

    document.addEventListener("click", event => {
        if (!(event.target instanceof Element) || !event.target.closest(".background-control")) {
            closeBackgroundMenu();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeBackgroundMenu();
        }
    });

    resizeHandle.addEventListener("pointerdown", event => {
        isResizing = true;
        startX = event.clientX;
        startWidth = dropdownPanel.offsetWidth;
        resizeHandle.setPointerCapture(event.pointerId);
        document.body.style.cursor = "ew-resize";
        event.preventDefault();
    });

    resizeHandle.addEventListener("pointermove", event => {
        if (!isResizing) {
            return;
        }

        const delta = startX - event.clientX;
        const maxWidth = window.innerWidth - 24;
        const nextWidth = Math.min(Math.max(startWidth + delta, 320), maxWidth);
        dropdownPanel.style.width = `${nextWidth}px`;
    });

    resizeHandle.addEventListener("pointerup", endResize);
    resizeHandle.addEventListener("pointercancel", endResize);

    function toggleDropdownPanel() {
        const isOpen = dropdownPanel.classList.toggle("open");
        const menuButton = document.getElementById("menuToggle");

        menuButton?.setAttribute("aria-label", isOpen ? "Close collaboration panel" : "Open collaboration panel");
        menuButton?.setAttribute("title", isOpen ? "Close panel" : "Open panel");
        dropdownPanel.setAttribute("aria-hidden", String(!isOpen));
        document.body.classList.toggle("panel-open", isOpen);
    }

    function showPanel(panel) {
        const panels = ["chat", "whiteboard"];

        panels.forEach(name => {
            const panelElement = document.getElementById(`${name}Panel`);
            const tabElement = document.getElementById(`${name}Tab`);
            const isActive = name === panel;

            panelElement.classList.toggle("active", isActive);
            panelElement.hidden = !isActive;
            tabElement.classList.toggle("active", isActive);
            tabElement.setAttribute("aria-selected", String(isActive));
        });

        if (panel === "whiteboard") {
            app.initializeWhiteboard?.();
        }
    }

    function toggleBackgroundMenu() {
        const support = app.getMediaFeatureSupport?.();

        if (support && !support.virtualBackground) {
            const message = support.isIOS
                ? "Virtual backgrounds are disabled on iPhone to prevent black video."
                : "Virtual backgrounds are not supported on this browser.";

            app.notify?.(message, true);
            app.appendSystemMessage?.(message);
            return;
        }

        if (!backgroundMenu) {
            app.toggleVirtualBackground?.();
            return;
        }

        const isOpen = backgroundMenu.hidden;
        backgroundMenu.hidden = !isOpen;
        backgroundButton?.setAttribute("aria-expanded", String(isOpen));
    }

    function closeBackgroundMenu() {
        if (!backgroundMenu || backgroundMenu.hidden) {
            return;
        }

        backgroundMenu.hidden = true;
        backgroundButton?.setAttribute("aria-expanded", "false");
    }

    function endResize() {
        if (!isResizing) {
            return;
        }

        isResizing = false;
        document.body.style.cursor = "";
    }

    function bindClick(id, handler) {
        document.getElementById(id)?.addEventListener("click", event => {
            event.preventDefault();
            handler(event);
        });
    }

    function applyFeatureSupport() {
        const support = app.getMediaFeatureSupport?.();

        if (!support) {
            return;
        }

        markUnsupported(
            "screenShareButton",
            !support.displayMedia,
            "Screen sharing is not supported on this browser");
        markUnsupported(
            "recordButton",
            !support.mediaRecorder,
            "Recording is not supported on this browser");
        markUnsupported(
            "virtualBackgroundButton",
            !support.virtualBackground,
            support.isIOS
                ? "Virtual backgrounds are disabled on iPhone to prevent black video"
                : "Virtual backgrounds are not supported on this browser");
    }

    function markUnsupported(id, isUnsupported, title) {
        const button = document.getElementById(id);

        if (!button || !isUnsupported) {
            return;
        }

        button.classList.add("is-unsupported");
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("title", title);
    }

    function notify(message, isError = false) {
        if (!appToast) {
            app.appendSystemMessage?.(message);
            return;
        }

        window.clearTimeout(toastTimer);
        appToast.textContent = message;
        appToast.classList.toggle("is-error", isError);
        appToast.hidden = false;
        toastTimer = window.setTimeout(() => {
            appToast.hidden = true;
        }, 4500);
    }

    dropdownPanel.setAttribute("aria-hidden", "true");

    app.toggleDropdownPanel = toggleDropdownPanel;
    app.showPanel = showPanel;
    app.closeBackgroundMenu = closeBackgroundMenu;
    app.notify = notify;
})();
