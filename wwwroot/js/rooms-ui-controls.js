(() => {
    const app = window.Collaboard = window.Collaboard || {};
    const dropdownPanel = document.getElementById("dropdownPanel");
    const resizeHandle = document.getElementById("panelResizeHandle");
    const backgroundMenu = document.getElementById("backgroundMenu");
    const backgroundButton = document.getElementById("virtualBackgroundButton");

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    bindClick("menuToggle", toggleDropdownPanel);
    bindClick("chatTab", () => showPanel("chat"));
    bindClick("whiteboardTab", () => showPanel("whiteboard"));
    bindClick("muteButton", () => app.toggleMute());
    bindClick("cameraButton", () => app.toggleCamera());
    bindClick("screenShareButton", () => app.toggleScreenShare());
    bindClick("virtualBackgroundButton", toggleBackgroundMenu);
    bindClick("raiseHandButton", () => app.raiseHand());
    bindClick("recordButton", () => app.toggleRecording());

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

    app.toggleDropdownPanel = toggleDropdownPanel;
    app.showPanel = showPanel;
    app.closeBackgroundMenu = closeBackgroundMenu;
})();
