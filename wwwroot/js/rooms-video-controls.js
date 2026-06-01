(() => {
    const app = window.Collaboard = window.Collaboard || {};
    const videoGrid = document.getElementById("videoGrid");
    const statusIndicator = document.getElementById("statusIndicator");
    const supportedVideoEffects = ["none", "blur", "blue-studio", "midnight-grid", "neon-focus", "cool-mono"];
    const videoEffectClasses = supportedVideoEffects
        .filter(effect => effect !== "none")
        .map(effect => `video-effect-${effect}`);
    const videoFrameClasses = supportedVideoEffects
        .filter(effect => effect !== "none")
        .map(effect => `video-frame-${effect}`);

    let isRecording = false;
    let mediaRecorder = null;
    let recordedChunks = [];
    let localVideoAdded = false;
    let isScreenSharing = false;
    let originalStream = null;
    let screenStream = null;
    let currentVideoEffect = "none";

    app.getLocalMedia = async function getLocalMedia() {
        const constraints = {
            audio: true,
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 24, max: 30 }
            }
        };

        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (videoError) {
            console.warn("Camera and microphone request failed.", videoError);

            try {
                return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            } catch (audioError) {
                console.warn("Audio-only request failed.", audioError);
                app.appendSystemMessage?.("Camera and microphone are unavailable. You can still use chat.");
                return new MediaStream();
            }
        }
    };

    app.addLocalVideo = function addLocalVideo(name) {
        if (localVideoAdded) {
            return;
        }

        localVideoAdded = true;
        addVideoTile(app.state.peerId, window.localStream, name, true);
        applyVideoEffect(app.state.peerId, currentVideoEffect);
    };

    app.addRemoteVideo = function addRemoteVideo(peerId, stream, name, effect = "none") {
        if (document.getElementById(tileId(peerId))) {
            applyVideoEffect(peerId, effect);
            return;
        }

        addVideoTile(peerId, stream, name, false);
        applyVideoEffect(peerId, effect);
    };

    app.removeVideoContainer = function removeVideoContainer(peerId) {
        document.getElementById(tileId(peerId))?.remove();
        updateVideoGridLayout();
    };

    app.updateStatusIndicator = function updateStatusIndicator() {
        const audioTrack = window.localStream?.getAudioTracks()[0];
        const videoTrack = window.localStream?.getVideoTracks()[0];
        const mic = audioTrack ? (audioTrack.enabled ? "On" : "Muted") : "Unavailable";
        const camera = videoTrack ? (videoTrack.enabled ? "On" : "Off") : "Unavailable";

        statusIndicator.textContent = `Mic: ${mic} | Camera: ${camera}`;
    };

    app.toggleMute = function toggleMute() {
        const audioTrack = window.localStream?.getAudioTracks()[0];

        if (!audioTrack) {
            app.appendSystemMessage?.("No microphone track is available.");
            return;
        }

        audioTrack.enabled = !audioTrack.enabled;
        document.getElementById("muteButton")?.classList.toggle("is-active", !audioTrack.enabled);
        app.updateStatusIndicator();
    };

    app.toggleCamera = async function toggleCamera() {
        const videoTrack = window.localStream?.getVideoTracks()[0];

        if (!videoTrack) {
            app.appendSystemMessage?.("No camera track is available.");
            return;
        }

        videoTrack.enabled = !videoTrack.enabled;
        setVideoTileCameraState(app.state.peerId, videoTrack.enabled);
        document.getElementById("cameraButton")?.classList.toggle("is-active", !videoTrack.enabled);
        app.updateStatusIndicator();

        await invokeHub("ToggleCamera", videoTrack.enabled);
    };

    app.setVideoEffect = async function setVideoEffect(effect) {
        if (!window.localStream?.getVideoTracks().length) {
            app.appendSystemMessage?.("No video track is available for background effects.");
            return;
        }

        currentVideoEffect = normalizeVideoEffect(effect);
        app.state.peerEffects?.set(app.state.peerId, currentVideoEffect);
        applyVideoEffect(app.state.peerId, currentVideoEffect);
        updateBackgroundControl();
        await invokeHub("SetVideoEffect", currentVideoEffect);
    };

    app.toggleVirtualBackground = async function toggleVirtualBackground() {
        const nextEffect = currentVideoEffect === "blur" ? "none" : "blur";
        await app.setVideoEffect(nextEffect);
    };

    app.raiseHand = async function raiseHand() {
        showRaisedHand(app.state.peerId);
        await invokeHub("RaiseHand");
    };

    app.toggleScreenShare = async function toggleScreenShare() {
        if (isScreenSharing) {
            await stopScreenShare();
            return;
        }

        await startScreenShare();
    };

    app.toggleRecording = async function toggleRecording() {
        if (!window.localStream || window.localStream.getTracks().length === 0) {
            app.appendSystemMessage?.("There is no local media stream to record.");
            return;
        }

        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }

        await invokeHub("ToggleRecording", isRecording);
    };

    app.setVideoTileCameraState = setVideoTileCameraState;
    app.applyVideoEffect = applyVideoEffect;
    app.toggleVideoVirtualBackground = toggleVideoVirtualBackground;
    app.getCurrentVideoEffect = () => currentVideoEffect;
    app.showRaisedHand = showRaisedHand;
    app.setScreenShareState = setScreenShareState;
    app.setRecordingState = setRecordingState;

    function addVideoTile(peerId, stream, name, isLocal) {
        const container = document.createElement("div");
        container.className = "video-container";
        container.id = tileId(peerId);

        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = isLocal;
        video.srcObject = stream;

        if (!isLocal) {
            video.addEventListener("loadedmetadata", () => {
                video.play().catch(error => console.warn("Remote video playback was blocked.", error));
            });
        }

        const label = document.createElement("div");
        label.className = "video-label";
        label.textContent = isLocal ? `${name} (you)` : name;

        const cameraOff = createStatusOverlay("camera-off-overlay", "fa-video-slash", "Camera off");
        const emptyState = createStatusOverlay("empty-video-state", "fa-user", "No video available");
        const handBadge = createIconBadge("hand-badge", "fa-hand");

        const recIndicator = document.createElement("div");
        recIndicator.className = "rec-indicator";

        container.append(video, cameraOff, emptyState, handBadge, recIndicator, label);
        videoGrid.appendChild(container);

        const hasVideo = stream?.getVideoTracks().length > 0;
        container.classList.toggle("no-video", !hasVideo);
        setVideoTileCameraState(peerId, !hasVideo || stream.getVideoTracks()[0].enabled);
        updateVideoGridLayout();
    }

    function setVideoTileCameraState(peerId, isEnabled) {
        const container = document.getElementById(tileId(peerId));

        if (container) {
            container.classList.toggle("camera-off", !isEnabled);
        }
    }

    function createStatusOverlay(className, iconName, text) {
        const overlay = document.createElement("div");
        const icon = document.createElement("i");
        const label = document.createElement("span");

        overlay.className = className;
        icon.className = `fa-solid ${iconName}`;
        icon.setAttribute("aria-hidden", "true");
        label.textContent = text;

        overlay.append(icon, label);
        return overlay;
    }

    function createIconBadge(className, iconName) {
        const badge = document.createElement("div");
        const icon = document.createElement("i");

        badge.className = className;
        icon.className = `fa-solid ${iconName}`;
        icon.setAttribute("aria-hidden", "true");
        badge.appendChild(icon);

        return badge;
    }

    function toggleVideoVirtualBackground(peerId) {
        const video = document.querySelector(`#${cssEscape(tileId(peerId))} video`);
        const hasBlur = video?.classList.contains("video-effect-blur") || video?.classList.contains("virtual-bg");

        applyVideoEffect(peerId, hasBlur ? "none" : "blur");
    }

    function applyVideoEffect(peerId, effect) {
        const selectedEffect = normalizeVideoEffect(effect);
        const container = document.getElementById(tileId(peerId));
        const video = container?.querySelector("video");

        if (!container || !video) {
            return;
        }

        video.classList.remove("virtual-bg", ...videoEffectClasses);
        container.classList.remove("has-video-effect", ...videoFrameClasses);

        if (selectedEffect !== "none") {
            video.classList.add(`video-effect-${selectedEffect}`);
            container.classList.add("has-video-effect", `video-frame-${selectedEffect}`);
        }

        if (peerId === app.state.peerId) {
            currentVideoEffect = selectedEffect;
            updateBackgroundControl();
        }
    }

    function updateBackgroundControl() {
        const hasEffect = currentVideoEffect !== "none";
        const backgroundButton = document.getElementById("virtualBackgroundButton");

        backgroundButton?.classList.toggle("is-active", hasEffect);
        backgroundButton?.setAttribute(
            "title",
            hasEffect ? `Background effect: ${formatEffectName(currentVideoEffect)}` : "Choose background effect");

        document.querySelectorAll("[data-background-effect]").forEach(option => {
            const isActive = option.dataset.backgroundEffect === currentVideoEffect;
            option.classList.toggle("is-active", isActive);
            option.setAttribute("aria-checked", String(isActive));
        });
    }

    function normalizeVideoEffect(effect) {
        return supportedVideoEffects.includes(effect) ? effect : "none";
    }

    function formatEffectName(effect) {
        return effect
            .split("-")
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function showRaisedHand(peerId) {
        const container = document.getElementById(tileId(peerId));

        if (!container) {
            return;
        }

        container.classList.add("hand-raised");
        window.setTimeout(() => container.classList.remove("hand-raised"), 5000);
    }

    function setScreenShareState(peerId, isSharing) {
        document.getElementById(tileId(peerId))?.classList.toggle("sharing-screen", isSharing);
    }

    function setRecordingState(peerId, recording) {
        document.getElementById(tileId(peerId))?.classList.toggle("is-recording", recording);
    }

    async function startScreenShare() {
        const currentStream = window.localStream;

        if (!currentStream) {
            app.appendSystemMessage?.("Start your camera or microphone before sharing your screen.");
            return;
        }

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            const screenTrack = screenStream.getVideoTracks()[0];
            const audioTrack = currentStream.getAudioTracks()[0];

            originalStream = currentStream;
            window.localStream = new MediaStream([screenTrack, audioTrack].filter(Boolean));
            app.replaceVideoTrackForPeers(screenTrack);
            setLocalVideoStream(window.localStream);
            setScreenShareState(app.state.peerId, true);
            setScreenShareButton(true);
            isScreenSharing = true;

            screenTrack.onended = () => {
                if (isScreenSharing) {
                    app.toggleScreenShare();
                }
            };

            await invokeHub("StartScreenShare");
        } catch (error) {
            console.warn("Screen share was cancelled or blocked.", error);
            app.appendSystemMessage?.("Screen sharing was cancelled or blocked.");
        }
    }

    async function stopScreenShare() {
        if (!originalStream) {
            return;
        }

        const cameraTrack = originalStream.getVideoTracks()[0];
        window.localStream.getVideoTracks().forEach(track => {
            if (track !== cameraTrack) {
                track.stop();
            }
        });

        window.localStream = originalStream;
        originalStream = null;
        screenStream = null;

        if (cameraTrack) {
            app.replaceVideoTrackForPeers(cameraTrack);
        }

        setLocalVideoStream(window.localStream);
        setScreenShareState(app.state.peerId, false);
        setScreenShareButton(false);
        isScreenSharing = false;
        app.updateStatusIndicator();

        await invokeHub("StopScreenShare");
    }

    function startRecording() {
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
            ? "video/webm;codecs=vp9"
            : "video/webm";

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(window.localStream, { mimeType });
        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        mediaRecorder.onstop = downloadRecording;
        mediaRecorder.start();

        isRecording = true;
        setRecordingState(app.state.peerId, true);
        document.getElementById("recordBtnLabel").textContent = "Stop";
        document.getElementById("recordButton")?.classList.add("is-active");
    }

    function stopRecording() {
        mediaRecorder?.stop();
        isRecording = false;
        setRecordingState(app.state.peerId, false);
        document.getElementById("recordBtnLabel").textContent = "Record";
        document.getElementById("recordButton")?.classList.remove("is-active");
    }

    function downloadRecording() {
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = `collaboard-recording-${Date.now()}.webm`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function setLocalVideoStream(stream) {
        const video = document.querySelector(`#${cssEscape(tileId(app.state.peerId))} video`);

        if (video) {
            video.srcObject = stream;
        }
    }

    function setScreenShareButton(sharing) {
        document.getElementById("screenShareBtnLabel").textContent = sharing ? "Stop" : "Share";
        document.getElementById("screenShareButton")?.classList.toggle("is-active", sharing);
    }

    function updateVideoGridLayout() {
        const count = Math.max(videoGrid.childElementCount, 1);
        const columns = count <= 1 ? 1 : count <= 4 ? 2 : Math.ceil(Math.sqrt(count));

        videoGrid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    }

    async function invokeHub(method, ...args) {
        const connection = app.state.connection;

        if (!connection || connection.state !== signalR.HubConnectionState.Connected) {
            app.appendSystemMessage?.("The room connection is not ready yet.");
            return;
        }

        try {
            await connection.invoke(method, ...args);
        } catch (error) {
            console.error(`Hub method ${method} failed.`, error);
            app.appendSystemMessage?.("That action could not be sent. Please try again.");
        }
    }

    function tileId(peerId) {
        return `container-${peerId}`;
    }

    function cssEscape(value) {
        return window.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }
})();
