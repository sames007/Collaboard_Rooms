(() => {
    const app = window.Collaboard = window.Collaboard || {};
    const maxConnectionAttempts = 8;

    const state = {
        roomName: getRoomName(),
        username: "Guest",
        connection: null,
        peer: null,
        peerId: null,
        peerUsernames: new Map(),
        peerEffects: new Map(),
        roomJoined: false,
        started: false
    };

    app.state = state;

    const roomDisplay = document.getElementById("roomNameDisplay");
    const usernameForm = document.getElementById("usernameForm");
    const usernameInput = document.getElementById("usernameInput");
    const usernameError = document.getElementById("usernameError");
    const usernameModal = document.getElementById("usernameModal");
    const usernameSubmitButton = usernameForm.querySelector("button[type='submit']");
    const connectionStatus = document.getElementById("connectionStatus");

    roomDisplay.textContent = state.roomName;
    usernameInput.focus();

    window.addEventListener("error", event => {
        if (!state.roomJoined) {
            handleStartupError("The room could not finish loading. Refresh and try again.", event.error);
        }
    });

    window.addEventListener("unhandledrejection", event => {
        if (!state.roomJoined) {
            handleStartupError("The room could not finish loading. Refresh and try again.", event.reason);
        }
    });

    usernameForm.addEventListener("submit", async event => {
        event.preventDefault();

        const displayName = usernameInput.value.trim();
        if (!displayName) {
            usernameError.textContent = "Enter a display name to join.";
            usernameInput.focus();
            return;
        }

        usernameError.textContent = "";
        state.username = displayName.slice(0, 40);
        setJoiningFormState(true, "Opening room...");

        try {
            await startSession();
        } catch (error) {
            handleStartupError("Unable to open the room. Refresh and try again.", error);
        }
    });

    async function startSession() {
        if (state.started) {
            return;
        }

        state.started = true;
        setConnectionStatus("Connecting...");

        if (typeof signalR === "undefined" || !signalR.HubConnectionBuilder) {
            handleStartupError("Real-time chat did not load. Check your connection and refresh.");
            return;
        }

        state.connection = new signalR.HubConnectionBuilder()
            .withUrl("/chatHub")
            .withAutomaticReconnect()
            .configureLogging(signalR.LogLevel.Warning)
            .build();

        registerSignalRHandlers(state.connection);
        await startConnectionWithRetry();
    }

    async function startConnectionWithRetry(attempt = 1) {
        try {
            await state.connection.start();
            setConnectionStatus("Opening room...");
            initializePeer();
        } catch (error) {
            console.warn(`SignalR connection attempt ${attempt} failed.`, error);

            if (attempt >= maxConnectionAttempts) {
                setConnectionStatus("Connection failed", true);
                app.appendSystemMessage?.("Unable to connect to the room. Refresh and try again.");
                handleStartupError("Unable to connect to the room. Refresh and try again.", error);
                return;
            }

            const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
            setConnectionStatus(`Connecting... retry ${attempt + 1}`);
            window.setTimeout(() => startConnectionWithRetry(attempt + 1), delay);
        }
    }

    function initializePeer() {
        if (typeof Peer !== "function") {
            handleStartupError("Video signaling did not load. Check your connection and refresh.");
            return;
        }

        try {
            state.peer = new Peer();
        } catch (error) {
            handleStartupError("Video signaling could not start in this browser.", error);
            return;
        }

        state.peer.on("open", id => {
            handlePeerOpen(id);
        });

        state.peer.on("call", call => app.handleIncomingCall(call));
        state.peer.on("error", error => {
            console.error("PeerJS error.", error);
            app.appendSystemMessage?.("Peer connection error. Video may be unavailable.");
            if (!state.peerId) {
                handleStartupError("Video signaling could not connect. Refresh and try again.", error);
            }
        });
    }

    async function handlePeerOpen(id) {
        try {
            state.peerId = id;
            state.peerUsernames.set(id, state.username);
            state.peerEffects.set(id, app.getCurrentVideoEffect?.() || "none");
            setConnectionStatus("Joining room...");

            const stream = await app.getLocalMedia();
            window.localStream = stream;
            app.addLocalVideo(state.username);
            app.updateStatusIndicator();
            hideJoinModal();

            try {
                await state.connection.invoke("JoinRoom", state.roomName, id, state.username);
                setRoomJoined(true);
                setConnectionStatus("Connected");
            } catch (error) {
                console.error("Unable to join room.", error);
                setRoomJoined(false);
                app.appendSystemMessage?.("Unable to join the room. Refresh and try again.");
                setConnectionStatus("Join failed", true);
            }
        } catch (error) {
            handleStartupError("Camera or video setup could not finish. Refresh and try again.", error);
        }
    }

    function registerSignalRHandlers(connection) {
        connection.on("ExistingPeers", peers => {
            peers.forEach(peerInfo => {
                const peerId = peerInfo.peerId ?? peerInfo.PeerId;
                const username = peerInfo.username ?? peerInfo.Username ?? peerId;

                if (!peerId || peerId === state.peerId) {
                    return;
                }

                state.peerUsernames.set(peerId, username);
                state.peerEffects.set(peerId, peerInfo.videoEffect ?? peerInfo.VideoEffect ?? "none");
                app.callPeer(peerId, username);
            });
        });

        connection.on("UserConnected", (peerId, username, videoEffect) => {
            if (peerId && peerId !== state.peerId) {
                state.peerUsernames.set(peerId, username || peerId);
                state.peerEffects.set(peerId, videoEffect || "none");
            }
        });

        connection.on("UserDisconnected", peerId => {
            state.peerUsernames.delete(peerId);
            state.peerEffects.delete(peerId);
            app.closeMediaConnection?.(peerId);
            app.removeVideoContainer(peerId);
        });

        connection.on("broadcastMessage", (name, message) => app.appendChatMessage?.(name, message));
        connection.on("CameraToggled", (peerId, isEnabled) => app.setVideoTileCameraState(peerId, isEnabled));
        connection.on("VirtualBackgroundToggled", peerId => app.toggleVideoVirtualBackground(peerId));
        connection.on("VideoEffectChanged", (peerId, videoEffect) => {
            state.peerEffects.set(peerId, videoEffect || "none");
            app.applyVideoEffect?.(peerId, videoEffect);
        });
        connection.on("UserRaisedHand", peerId => app.showRaisedHand(peerId));
        connection.on("ScreenShareStarted", peerId => app.setScreenShareState(peerId, true));
        connection.on("ScreenShareStopped", peerId => app.setScreenShareState(peerId, false));
        connection.on("RecordingToggled", (peerId, isRecording) => app.setRecordingState(peerId, isRecording));

        connection.onreconnecting(() => {
            setRoomJoined(false);
            setConnectionStatus("Reconnecting...");
        });
        connection.onreconnected(async () => {
            setConnectionStatus("Rejoining room...");

            if (state.peerId) {
                await connection.invoke("JoinRoom", state.roomName, state.peerId, state.username);
                setRoomJoined(true);
                setConnectionStatus("Connected");
            }
        });
        connection.onclose(() => {
            setRoomJoined(false);
            setConnectionStatus("Disconnected", true);
        });
    }

    function getRoomName() {
        const params = new URLSearchParams(window.location.search);
        const hash = window.location.hash.startsWith("#")
            ? window.location.hash.slice(1)
            : window.location.hash;
        const hashParams = new URLSearchParams(hash);
        const room = hashParams.get("room")?.trim() || params.get("room")?.trim();

        return room ? room.slice(0, 64) : "TestRoom";
    }

    function setConnectionStatus(message, isError = false) {
        connectionStatus.textContent = message;
        connectionStatus.classList.toggle("is-error", isError);
    }

    function setJoiningFormState(isJoining, message, isError = false) {
        usernameInput.disabled = isJoining;
        usernameSubmitButton.disabled = isJoining;
        usernameSubmitButton.textContent = isJoining ? "Joining..." : "Join room";
        usernameError.textContent = message;
        usernameError.classList.toggle("is-info", !isError && Boolean(message));
    }

    function hideJoinModal() {
        usernameModal.style.display = "none";
        setJoiningFormState(false, "");
    }

    function handleStartupError(message, error) {
        if (error) {
            console.error(message, error);
        }

        cleanupStartupConnections();
        state.started = false;
        setRoomJoined(false);
        setConnectionStatus("Connection failed", true);
        usernameModal.style.display = "flex";
        setJoiningFormState(false, message, true);
    }

    function cleanupStartupConnections() {
        try {
            state.peer?.destroy?.();
        } catch (error) {
            console.warn("Unable to clean up PeerJS after startup failure.", error);
        }

        try {
            void state.connection?.stop?.();
        } catch (error) {
            console.warn("Unable to stop SignalR after startup failure.", error);
        }

        state.peer = null;
        state.peerId = null;
        state.connection = null;
    }

    function setRoomJoined(isJoined) {
        state.roomJoined = isJoined;
        app.setChatAvailability?.(isJoined);
        window.dispatchEvent(new CustomEvent("collaboard:room-ready", {
            detail: { ready: isJoined }
        }));
    }

    app.setConnectionStatus = setConnectionStatus;
})();
