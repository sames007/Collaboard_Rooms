(() => {
    const app = window.Collaboard = window.Collaboard || {};
    const videoGrid = document.getElementById("videoGrid");
    const statusIndicator = document.getElementById("statusIndicator");
    const backgroundConfigs = {
        "none": { label: "Original", type: "none" },
        "blur": { label: "Soft blur", type: "blur" },
        "blue-studio": { label: "Blue studio", type: "image", src: "backgrounds/blue-studio.svg" },
        "city-night": { label: "City night", type: "image", src: "backgrounds/city-night.svg" },
        "ocean-glass": { label: "Ocean glass", type: "image", src: "backgrounds/ocean-glass.svg" },
        "focus-room": { label: "Focus room", type: "image", src: "backgrounds/focus-room.svg" },
        "aurora-grid": { label: "Aurora grid", type: "image", src: "backgrounds/aurora-grid.svg" }
    };
    const supportedVideoEffects = Object.keys(backgroundConfigs);
    const loadedBackgrounds = new Map();
    const mediaFeatureSupport = getMediaFeatureSupport();

    document.documentElement.dataset.mediaPipe = mediaFeatureSupport.mediaPipe ? "ready" : "missing";
    document.documentElement.dataset.virtualBackground = mediaFeatureSupport.virtualBackground ? "ready" : "unsupported";

    let isRecording = false;
    let mediaRecorder = null;
    let recordedChunks = [];
    let localVideoAdded = false;
    let isScreenSharing = false;
    let originalStream = null;
    let screenStream = null;
    let rawLocalStream = null;
    let processedStream = null;
    let processedVideoTrack = null;
    let segmentation = null;
    let segmentationCanvas = null;
    let segmentationContext = null;
    let segmentationSourceVideo = null;
    let segmentationFrameRequest = 0;
    let segmentationInFlight = false;
    let segmentationErrorShown = false;
    let currentVideoEffect = "none";
    let backgroundBeforeScreenShare = "none";
    let recordingMimeType = "video/webm";

    app.getLocalMedia = async function getLocalMedia() {
        if (!mediaFeatureSupport.getUserMedia) {
            app.notify?.("Camera and microphone need a browser with media support. Use the HTTPS Render link on iPhone.", true);
            app.appendSystemMessage?.("Camera and microphone are unavailable in this browser or context.");
            rawLocalStream = new MediaStream();
            return rawLocalStream;
        }

        const constraints = {
            audio: true,
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 24, max: 30 }
            }
        };

        try {
            rawLocalStream = await navigator.mediaDevices.getUserMedia(constraints);
            return rawLocalStream;
        } catch (videoError) {
            console.warn("Camera and microphone request failed.", videoError);

            try {
                rawLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                return rawLocalStream;
            } catch (audioError) {
                console.warn("Audio-only request failed.", audioError);
                app.notify?.("Camera and microphone are unavailable. You can still use chat.", true);
                app.appendSystemMessage?.("Camera and microphone are unavailable. You can still use chat.");
                rawLocalStream = new MediaStream();
                return rawLocalStream;
            }
        }
    };

    app.addLocalVideo = function addLocalVideo(name) {
        if (localVideoAdded) {
            return;
        }

        rawLocalStream ??= window.localStream;
        localVideoAdded = true;
        addVideoTile(app.state.peerId, window.localStream, name, true);
        setVideoTileBackgroundState(app.state.peerId, currentVideoEffect);
    };

    app.addRemoteVideo = function addRemoteVideo(peerId, stream, name, effect = "none") {
        if (document.getElementById(tileId(peerId))) {
            setVideoTileBackgroundState(peerId, effect);
            return;
        }

        addVideoTile(peerId, stream, name, false);
        setVideoTileBackgroundState(peerId, effect);
    };

    app.removeVideoContainer = function removeVideoContainer(peerId) {
        document.getElementById(tileId(peerId))?.remove();
        updateVideoGridLayout();
    };

    app.updateStatusIndicator = function updateStatusIndicator() {
        const audioTrack = getActiveAudioTrack();
        const videoTrack = getControllableVideoTrack();
        const mic = audioTrack ? (audioTrack.enabled ? "On" : "Muted") : "Unavailable";
        const camera = videoTrack ? (videoTrack.enabled ? "On" : "Off") : "Unavailable";

        statusIndicator.textContent = `Mic: ${mic} | Camera: ${camera}`;
    };

    app.toggleMute = function toggleMute() {
        const audioTrack = getActiveAudioTrack();

        if (!audioTrack) {
            app.appendSystemMessage?.("No microphone track is available.");
            return;
        }

        audioTrack.enabled = !audioTrack.enabled;
        document.getElementById("muteButton")?.classList.toggle("is-active", !audioTrack.enabled);
        app.updateStatusIndicator();
    };

    app.toggleCamera = async function toggleCamera() {
        const videoTrack = getControllableVideoTrack();

        if (!videoTrack) {
            app.appendSystemMessage?.("No camera track is available.");
            return;
        }

        videoTrack.enabled = !videoTrack.enabled;

        if (processedVideoTrack) {
            processedVideoTrack.enabled = videoTrack.enabled;
        }

        setVideoTileCameraState(app.state.peerId, videoTrack.enabled);
        document.getElementById("cameraButton")?.classList.toggle("is-active", !videoTrack.enabled);
        app.updateStatusIndicator();

        await invokeHub("ToggleCamera", videoTrack.enabled);
    };

    app.setVideoEffect = async function setVideoEffect(effect) {
        const selectedEffect = normalizeVideoEffect(effect);

        if (selectedEffect !== "none" && !mediaFeatureSupport.virtualBackground) {
            const message = mediaFeatureSupport.isIOS
                ? "Virtual backgrounds are disabled on iPhone to prevent black video. Your camera can still be used normally."
                : "Virtual backgrounds are not supported by this browser. Your camera can still be used normally.";

            app.notify?.(message, true);
            app.appendSystemMessage?.(message);
            return;
        }

        if (selectedEffect !== "none" && !getRawVideoTrack()) {
            app.notify?.("Allow camera access before choosing a virtual background.", true);
            app.appendSystemMessage?.("No camera track is available for MediaPipe background replacement.");
            return;
        }

        try {
            currentVideoEffect = selectedEffect;
            app.state.peerEffects?.set(app.state.peerId, currentVideoEffect);

            if (currentVideoEffect === "none") {
                await stopVirtualBackgroundProcessor(true);
            } else if (isScreenSharing) {
                app.notify?.("Background changes will apply when screen sharing stops.");
                app.appendSystemMessage?.("Background changes will apply when screen sharing stops.");
            } else {
                await startOrUpdateVirtualBackground(currentVideoEffect);
                app.notify?.(`Background set to ${backgroundConfigs[currentVideoEffect].label}.`);
            }

            updateBackgroundControl();
            setVideoTileBackgroundState(app.state.peerId, isScreenSharing ? "none" : currentVideoEffect);
            await invokeHub("SetVideoEffect", currentVideoEffect);
        } catch (error) {
            console.error("Unable to apply MediaPipe background.", error);
            app.notify?.("MediaPipe background replacement could not start in this browser.", true);
            app.appendSystemMessage?.("MediaPipe background replacement could not start in this browser.");
            currentVideoEffect = "none";
            app.state.peerEffects?.set(app.state.peerId, currentVideoEffect);
            await stopVirtualBackgroundProcessor(true);
            updateBackgroundControl();
            setVideoTileBackgroundState(app.state.peerId, currentVideoEffect);
            await invokeHub("SetVideoEffect", currentVideoEffect);
        }
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
        if (!mediaFeatureSupport.displayMedia) {
            app.notify?.("Screen sharing is not supported on this browser.", true);
            app.appendSystemMessage?.("Screen sharing is not available on this browser.");
            return;
        }

        if (isScreenSharing) {
            await stopScreenShare();
            return;
        }

        await startScreenShare();
    };

    app.toggleRecording = async function toggleRecording() {
        if (!mediaFeatureSupport.mediaRecorder) {
            app.notify?.("Recording is not supported on this browser.", true);
            app.appendSystemMessage?.("Recording is not available on this browser.");
            return;
        }

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
    app.applyVideoEffect = setVideoTileBackgroundState;
    app.toggleVideoVirtualBackground = toggleVideoVirtualBackground;
    app.getMediaFeatureSupport = () => ({ ...mediaFeatureSupport });
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
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.muted = isLocal;
        video.srcObject = stream;

        video.addEventListener("loadedmetadata", () => playVideoElement(video, isLocal));
        video.addEventListener("canplay", () => playVideoElement(video, isLocal), { once: true });

        const label = document.createElement("div");
        label.className = "video-label";
        label.textContent = isLocal ? `${name} (you)` : name;

        const cameraOff = createStatusOverlay("camera-off-overlay", "fa-video-slash", "Camera off");
        const emptyState = createStatusOverlay("empty-video-state", "fa-user", "No video available");
        const handBadge = createIconBadge("hand-badge", "fa-hand");
        const backgroundBadge = createBackgroundBadge();
        const badgeStack = document.createElement("div");

        const recIndicator = document.createElement("div");
        recIndicator.className = "rec-indicator";

        badgeStack.className = "video-badge-stack";
        badgeStack.append(backgroundBadge, handBadge);

        container.append(video, cameraOff, emptyState, badgeStack, recIndicator, label);
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

    function setVideoTileBackgroundState(peerId, effect) {
        const container = document.getElementById(tileId(peerId));
        const selectedEffect = normalizeVideoEffect(effect);
        const hasBackground = selectedEffect !== "none";
        const badge = container?.querySelector(".background-badge");
        const label = badge?.querySelector("span");

        if (!container) {
            return;
        }

        container.classList.toggle("has-video-background", hasBackground);
        container.dataset.videoEffect = selectedEffect;

        if (badge && label) {
            label.textContent = selectedEffect === "blur" ? "Blur" : "BG";
            badge.title = backgroundConfigs[selectedEffect].label;
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

    function createBackgroundBadge() {
        const badge = document.createElement("div");
        const icon = document.createElement("i");
        const label = document.createElement("span");

        badge.className = "background-badge";
        icon.className = "fa-solid fa-wand-magic-sparkles";
        icon.setAttribute("aria-hidden", "true");
        label.textContent = "BG";
        badge.append(icon, label);

        return badge;
    }

    function toggleVideoVirtualBackground(peerId) {
        const container = document.getElementById(tileId(peerId));
        const currentEffect = container?.dataset.videoEffect || "none";
        setVideoTileBackgroundState(peerId, currentEffect === "blur" ? "none" : "blur");
    }

    async function startOrUpdateVirtualBackground(effect) {
        await loadBackgroundImage(effect);

        if (processedVideoTrack) {
            return;
        }

        if (!mediaFeatureSupport.mediaPipe) {
            throw new Error("MediaPipe SelfieSegmentation is not loaded.");
        }

        if (!mediaFeatureSupport.canvasCaptureStream) {
            throw new Error("Canvas captureStream is not supported.");
        }

        const cameraTrack = getRawVideoTrack();

        if (!cameraTrack) {
            throw new Error("No camera track is available.");
        }

        segmentationSourceVideo = document.createElement("video");
        segmentationSourceVideo.autoplay = true;
        segmentationSourceVideo.muted = true;
        segmentationSourceVideo.playsInline = true;
        segmentationSourceVideo.setAttribute("playsinline", "");
        segmentationSourceVideo.setAttribute("webkit-playsinline", "");
        segmentationSourceVideo.srcObject = new MediaStream([cameraTrack]);
        await segmentationSourceVideo.play();
        await waitForVideoMetadata(segmentationSourceVideo);

        segmentationCanvas = document.createElement("canvas");
        segmentationContext = segmentationCanvas.getContext("2d");
        resizeSegmentationCanvas();
        drawInitialProcessedFrame();

        segmentation = new window.SelfieSegmentation({
            locateFile: file => `vendor/mediapipe/selfie_segmentation/${file}`
        });
        segmentation.setOptions({
            modelSelection: 1,
            selfieMode: true
        });
        segmentation.onResults(drawSegmentedFrame);

        const frameRate = clamp(cameraTrack.getSettings().frameRate || 24, 12, 30);
        processedVideoTrack = segmentationCanvas.captureStream(frameRate).getVideoTracks()[0];
        processedVideoTrack.enabled = cameraTrack.enabled;
        processedStream = new MediaStream([processedVideoTrack, ...getRawAudioTracks()]);
        window.localStream = processedStream;
        setLocalVideoStream(processedStream);
        app.replaceVideoTrackForPeers(processedVideoTrack);
        segmentationErrorShown = false;
        processSegmentationFrame();
    }

    async function stopVirtualBackgroundProcessor(restoreRawStream) {
        if (segmentationFrameRequest) {
            cancelAnimationFrame(segmentationFrameRequest);
            segmentationFrameRequest = 0;
        }

        segmentationInFlight = false;
        segmentationSourceVideo?.pause();

        if (segmentationSourceVideo) {
            segmentationSourceVideo.srcObject = null;
        }

        if (typeof segmentation?.close === "function") {
            await segmentation.close();
        }

        processedVideoTrack?.stop();
        processedVideoTrack = null;
        processedStream = null;
        segmentation = null;
        segmentationCanvas = null;
        segmentationContext = null;
        segmentationSourceVideo = null;

        if (restoreRawStream && rawLocalStream) {
            window.localStream = rawLocalStream;
            setLocalVideoStream(rawLocalStream);

            const cameraTrack = getRawVideoTrack();

            if (cameraTrack) {
                app.replaceVideoTrackForPeers(cameraTrack);
                setVideoTileCameraState(app.state.peerId, cameraTrack.enabled);
            }

            app.updateStatusIndicator();
        }
    }

    // MediaPipe returns a person mask. The canvas becomes the outgoing WebRTC video track.
    async function processSegmentationFrame() {
        if (!segmentation || !segmentationSourceVideo || !processedVideoTrack) {
            return;
        }

        if (!segmentationInFlight && segmentationSourceVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            segmentationInFlight = true;

            try {
                resizeSegmentationCanvas();
                await segmentation.send({ image: segmentationSourceVideo });
            } catch (error) {
                if (!segmentationErrorShown) {
                    console.warn("MediaPipe frame processing failed.", error);
                    app.notify?.("MediaPipe background processing paused. Try changing backgrounds or refreshing.", true);
                    app.appendSystemMessage?.("MediaPipe background processing paused. Try changing backgrounds or refreshing.");
                    segmentationErrorShown = true;
                }
            } finally {
                segmentationInFlight = false;
            }
        }

        segmentationFrameRequest = requestAnimationFrame(processSegmentationFrame);
    }

    function drawSegmentedFrame(results) {
        if (!segmentationCanvas || !segmentationContext || !results.image || !results.segmentationMask) {
            return;
        }

        const { width, height } = segmentationCanvas;
        const context = segmentationContext;

        context.save();
        context.clearRect(0, 0, width, height);
        context.filter = "blur(1.2px)";
        context.drawImage(results.segmentationMask, 0, 0, width, height);
        context.filter = "none";
        context.globalCompositeOperation = "source-in";
        context.drawImage(results.image, 0, 0, width, height);
        context.globalCompositeOperation = "destination-over";
        drawSelectedBackground(context, results.image, width, height);
        context.globalCompositeOperation = "source-over";
        context.restore();
    }

    function drawInitialProcessedFrame() {
        if (!segmentationCanvas || !segmentationContext || !segmentationSourceVideo) {
            return;
        }

        const { width, height } = segmentationCanvas;
        const context = segmentationContext;

        context.save();
        context.clearRect(0, 0, width, height);
        drawSelectedBackground(context, segmentationSourceVideo, width, height);
        context.globalAlpha = 0.98;
        drawImageCover(context, segmentationSourceVideo, width, height);
        context.restore();
    }

    function drawSelectedBackground(context, sourceImage, width, height) {
        const config = backgroundConfigs[currentVideoEffect] || backgroundConfigs.none;

        if (config.type === "blur") {
            context.save();
            context.filter = "blur(18px) brightness(0.72) saturate(1.16)";
            drawImageCover(context, sourceImage, width, height, 1.12);
            context.restore();
            drawCanvasGradient(context, width, height, 0.2);
            return;
        }

        if (config.type === "image") {
            const image = loadedBackgrounds.get(currentVideoEffect);

            if (image) {
                drawImageCover(context, image, width, height);
                return;
            }
        }

        drawCanvasGradient(context, width, height, 0.75);
    }

    function drawImageCover(context, image, width, height, scaleBoost = 1) {
        const imageWidth = image.videoWidth || image.naturalWidth || image.width || width;
        const imageHeight = image.videoHeight || image.naturalHeight || image.height || height;
        const scale = Math.max(width / imageWidth, height / imageHeight) * scaleBoost;
        const drawWidth = imageWidth * scale;
        const drawHeight = imageHeight * scale;
        const x = (width - drawWidth) / 2;
        const y = (height - drawHeight) / 2;

        context.drawImage(image, x, y, drawWidth, drawHeight);
    }

    function drawCanvasGradient(context, width, height, opacity) {
        const gradient = context.createLinearGradient(0, 0, width, height);

        gradient.addColorStop(0, `rgba(2, 8, 23, ${opacity})`);
        gradient.addColorStop(0.52, `rgba(37, 99, 235, ${opacity * 0.72})`);
        gradient.addColorStop(1, `rgba(56, 189, 248, ${opacity * 0.42})`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
    }

    async function loadBackgroundImage(effect) {
        const config = backgroundConfigs[effect];

        if (!config?.src || loadedBackgrounds.has(effect)) {
            return;
        }

        const image = new Image();
        image.decoding = "async";
        image.src = config.src;

        try {
            await image.decode();
        } catch {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
            });
        }

        loadedBackgrounds.set(effect, image);
    }

    function resizeSegmentationCanvas() {
        if (!segmentationCanvas || !segmentationSourceVideo) {
            return;
        }

        const settings = getRawVideoTrack()?.getSettings() || {};
        const width = segmentationSourceVideo.videoWidth || settings.width || 1280;
        const height = segmentationSourceVideo.videoHeight || settings.height || 720;

        if (segmentationCanvas.width !== width || segmentationCanvas.height !== height) {
            segmentationCanvas.width = width;
            segmentationCanvas.height = height;
        }
    }

    function updateBackgroundControl() {
        const hasEffect = currentVideoEffect !== "none";
        const backgroundButton = document.getElementById("virtualBackgroundButton");

        backgroundButton?.classList.toggle("is-active", hasEffect);
        backgroundButton?.setAttribute(
            "title",
            hasEffect ? `Background: ${backgroundConfigs[currentVideoEffect].label}` : "Choose background");

        document.querySelectorAll("[data-background-effect]").forEach(option => {
            const isActive = option.dataset.backgroundEffect === currentVideoEffect;
            option.classList.toggle("is-active", isActive);
            option.setAttribute("aria-checked", String(isActive));
        });
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
        const baseStream = rawLocalStream ?? window.localStream;

        if (!baseStream) {
            app.appendSystemMessage?.("Start your camera or microphone before sharing your screen.");
            return;
        }

        backgroundBeforeScreenShare = currentVideoEffect;

        if (backgroundBeforeScreenShare !== "none") {
            await stopVirtualBackgroundProcessor(true);
            setVideoTileBackgroundState(app.state.peerId, "none");
        }

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            const screenTrack = screenStream.getVideoTracks()[0];
            const audioTrack = baseStream.getAudioTracks()[0];

            originalStream = baseStream;
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

            if (backgroundBeforeScreenShare !== "none") {
                await invokeHub("SetVideoEffect", "none");
            }

            await invokeHub("StartScreenShare");
        } catch (error) {
            console.warn("Screen share was cancelled or blocked.", error);
            app.appendSystemMessage?.("Screen sharing was cancelled or blocked.");
            await restoreBackgroundAfterScreenShare();
        }
    }

    async function stopScreenShare() {
        if (!originalStream) {
            return;
        }

        window.localStream.getVideoTracks().forEach(track => {
            if (!originalStream.getVideoTracks().includes(track)) {
                track.stop();
            }
        });

        window.localStream = originalStream;
        originalStream = null;
        screenStream = null;

        const cameraTrack = getRawVideoTrack();

        if (cameraTrack) {
            app.replaceVideoTrackForPeers(cameraTrack);
        }

        setLocalVideoStream(window.localStream);
        setScreenShareState(app.state.peerId, false);
        setScreenShareButton(false);
        isScreenSharing = false;
        await restoreBackgroundAfterScreenShare();
        app.updateStatusIndicator();

        if (currentVideoEffect !== "none") {
            await invokeHub("SetVideoEffect", currentVideoEffect);
        }

        await invokeHub("StopScreenShare");
    }

    async function restoreBackgroundAfterScreenShare() {
        const effectToRestore = backgroundBeforeScreenShare;

        backgroundBeforeScreenShare = "none";

        if (effectToRestore !== "none" && currentVideoEffect === effectToRestore) {
            try {
                await startOrUpdateVirtualBackground(effectToRestore);
                setVideoTileBackgroundState(app.state.peerId, effectToRestore);
            } catch (error) {
                console.warn("Unable to restore MediaPipe background after screen sharing.", error);
                currentVideoEffect = "none";
                updateBackgroundControl();
                setVideoTileBackgroundState(app.state.peerId, currentVideoEffect);
            }
        }
    }

    function startRecording() {
        const recordingOptions = getRecordingOptions();

        recordedChunks = [];

        try {
            mediaRecorder = new MediaRecorder(window.localStream, recordingOptions);
            recordingMimeType = mediaRecorder.mimeType || recordingOptions.mimeType || "video/webm";
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
        } catch (error) {
            console.warn("Recording could not start.", error);
            app.notify?.("Recording could not start in this browser.", true);
            app.appendSystemMessage?.("Recording could not start in this browser.");
        }
    }

    function stopRecording() {
        mediaRecorder?.stop();
        isRecording = false;
        setRecordingState(app.state.peerId, false);
        document.getElementById("recordBtnLabel").textContent = "Record";
        document.getElementById("recordButton")?.classList.remove("is-active");
    }

    function downloadRecording() {
        const mimeType = recordingMimeType || "video/webm";
        const extension = mimeType.includes("mp4") ? "mp4" : "webm";
        const blob = new Blob(recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = `collaboard-recording-${Date.now()}.${extension}`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }

    function setLocalVideoStream(stream) {
        const video = document.querySelector(`#${cssEscape(tileId(app.state.peerId))} video`);

        if (video) {
            video.srcObject = stream;
            playVideoElement(video, true);
        }
    }

    function playVideoElement(video, isLocal) {
        if (!video || typeof video.play !== "function") {
            return;
        }

        video.play().catch(error => {
            const label = isLocal ? "Local" : "Remote";
            console.warn(`${label} video playback was blocked.`, error);
        });
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

    function getActiveAudioTrack() {
        return rawLocalStream?.getAudioTracks()[0] || window.localStream?.getAudioTracks()[0] || null;
    }

    function getRawAudioTracks() {
        return rawLocalStream?.getAudioTracks() || window.localStream?.getAudioTracks() || [];
    }

    function getRawVideoTrack() {
        return rawLocalStream?.getVideoTracks()[0] || null;
    }

    function getControllableVideoTrack() {
        return getRawVideoTrack() || window.localStream?.getVideoTracks()[0] || null;
    }

    function normalizeVideoEffect(effect) {
        return Object.prototype.hasOwnProperty.call(backgroundConfigs, effect) ? effect : "none";
    }

    function getMediaFeatureSupport() {
        const mediaDevices = navigator.mediaDevices || {};
        const canvasCaptureStream = Boolean(HTMLCanvasElement.prototype.captureStream);
        const isIOS = isIOSDevice();
        const mediaPipe = Boolean(window.SelfieSegmentation);

        return {
            canvasCaptureStream,
            displayMedia: typeof mediaDevices.getDisplayMedia === "function",
            getUserMedia: typeof mediaDevices.getUserMedia === "function",
            isIOS,
            mediaPipe,
            mediaRecorder: typeof window.MediaRecorder === "function",
            virtualBackground: mediaPipe && canvasCaptureStream && !isIOS
        };
    }

    function isIOSDevice() {
        const platform = navigator.platform || "";
        const userAgent = navigator.userAgent || "";
        const isTouchMac = platform === "MacIntel" && navigator.maxTouchPoints > 1;

        return /iPad|iPhone|iPod/.test(platform) || /iPad|iPhone|iPod/.test(userAgent) || isTouchMac;
    }

    function getRecordingOptions() {
        const preferredTypes = [
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm",
            "video/mp4"
        ];

        if (typeof MediaRecorder.isTypeSupported !== "function") {
            return {};
        }

        const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type));
        return mimeType ? { mimeType } : {};
    }

    function waitForVideoMetadata(video) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            const timeout = window.setTimeout(resolve, 1500);
            video.addEventListener("loadedmetadata", () => {
                window.clearTimeout(timeout);
                resolve();
            }, { once: true });
        });
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function tileId(peerId) {
        return `container-${peerId}`;
    }

    function cssEscape(value) {
        return window.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    }
})();
