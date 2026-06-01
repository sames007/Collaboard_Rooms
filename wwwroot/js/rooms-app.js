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
        started: false
    };

    app.state = state;

    const roomDisplay = document.getElementById("roomNameDisplay");
    const usernameForm = document.getElementById("usernameForm");
    const usernameInput = document.getElementById("usernameInput");
    const usernameError = document.getElementById("usernameError");
    const usernameModal = document.getElementById("usernameModal");
    const connectionStatus = document.getElementById("connectionStatus");

    roomDisplay.textContent = state.roomName;
    usernameInput.focus();

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
        usernameModal.style.display = "none";

        await startSession();
    });

    async function startSession() {
        if (state.started) {
            return;
        }

        state.started = true;
        setConnectionStatus("Connecting...");

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
            setConnectionStatus("Connected");
            initializePeer();
        } catch (error) {
            console.warn(`SignalR connection attempt ${attempt} failed.`, error);

            if (attempt >= maxConnectionAttempts) {
                setConnectionStatus("Connection failed", true);
                app.appendSystemMessage?.("Unable to connect to the room. Refresh and try again.");
                return;
            }

            const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
            setConnectionStatus(`Connecting... retry ${attempt + 1}`);
            window.setTimeout(() => startConnectionWithRetry(attempt + 1), delay);
        }
    }

    function initializePeer() {
        state.peer = new Peer();

        state.peer.on("open", async id => {
            state.peerId = id;
            state.peerUsernames.set(id, state.username);
            state.peerEffects.set(id, app.getCurrentVideoEffect?.() || "none");

            const stream = await app.getLocalMedia();
            window.localStream = stream;
            app.addLocalVideo(state.username);
            app.updateStatusIndicator();

            try {
                await state.connection.invoke("JoinRoom", state.roomName, id, state.username);
            } catch (error) {
                console.error("Unable to join room.", error);
                app.appendSystemMessage?.("Unable to join the room. Refresh and try again.");
                setConnectionStatus("Join failed", true);
            }
        });

        state.peer.on("call", call => app.handleIncomingCall(call));
        state.peer.on("error", error => {
            console.error("PeerJS error.", error);
            app.appendSystemMessage?.("Peer connection error. Video may be unavailable.");
        });
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

        connection.onreconnecting(() => setConnectionStatus("Reconnecting..."));
        connection.onreconnected(async () => {
            setConnectionStatus("Connected");

            if (state.peerId) {
                await connection.invoke("JoinRoom", state.roomName, state.peerId, state.username);
            }
        });
        connection.onclose(() => setConnectionStatus("Disconnected", true));
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

    app.setConnectionStatus = setConnectionStatus;
})();
