(() => {
    const app = window.Collaboard = window.Collaboard || {};
    let initialized = false;

    app.initializeWhiteboard = function initializeWhiteboard() {
        const container = document.getElementById("wt-container");

        if (initialized || !container) {
            return;
        }

        initialized = true;

        if (!window.api?.WhiteboardTeam) {
            showFallback(container, "Whiteboard is unavailable. Check the Whiteboard.Team script or network connection.");
            return;
        }

        try {
            new api.WhiteboardTeam("#wt-container", {
                clientId: "826eece0e58a661b21e57fdde1c4b032",
                boardCode: createBoardCode(app.state.roomName)
            });
        } catch (error) {
            console.error("Whiteboard initialization failed.", error);
            showFallback(container, "Whiteboard could not be started for this room.");
        }
    };

    function createBoardCode(roomName) {
        const source = `collaboard:${roomName}`;
        let hash = 2166136261;

        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        const hex = Math.abs(hash).toString(16).padStart(8, "0");
        return `${hex}-147c-48d4-8c84-6209d3816837`;
    }

    function showFallback(container, message) {
        container.replaceChildren();

        const fallback = document.createElement("div");
        fallback.className = "whiteboard-fallback";
        fallback.textContent = message;
        container.appendChild(fallback);
    }
})();
