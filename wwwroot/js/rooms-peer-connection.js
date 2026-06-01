(() => {
    const app = window.Collaboard = window.Collaboard || {};
    const mediaConnections = new Map();

    app.callPeer = function callPeer(remoteId, remoteName) {
        const { state } = app;

        if (!state.peer || !remoteId || remoteId === state.peerId || mediaConnections.has(remoteId)) {
            return;
        }

        const stream = window.localStream ?? new MediaStream();
        const call = state.peer.call(remoteId, stream, {
            metadata: { username: state.username }
        });

        trackConnection(remoteId, call);
        call.on("stream", remoteStream => app.addRemoteVideo(remoteId, remoteStream, remoteName));
    };

    app.handleIncomingCall = function handleIncomingCall(call) {
        const { state } = app;
        const callerName = call.metadata?.username ||
            state.peerUsernames.get(call.peer) ||
            call.peer.slice(0, 8);

        state.peerUsernames.set(call.peer, callerName);
        call.answer(window.localStream ?? new MediaStream());
        trackConnection(call.peer, call);
        call.on("stream", stream => app.addRemoteVideo(call.peer, stream, callerName));
    };

    app.replaceVideoTrackForPeers = function replaceVideoTrackForPeers(videoTrack) {
        mediaConnections.forEach(call => {
            const sender = call.peerConnection
                ?.getSenders()
                .find(candidate => candidate.track?.kind === "video");

            if (sender) {
                sender.replaceTrack(videoTrack).catch(error => {
                    console.error("Unable to replace peer video track.", error);
                });
            }
        });
    };

    app.closeMediaConnection = function closeMediaConnection(peerId) {
        const call = mediaConnections.get(peerId);

        if (call) {
            call.close();
            mediaConnections.delete(peerId);
        }
    };

    function trackConnection(peerId, call) {
        mediaConnections.set(peerId, call);

        call.on("close", () => {
            mediaConnections.delete(peerId);
            app.removeVideoContainer(peerId);
        });

        call.on("error", error => {
            console.error("Peer media connection error.", error);
            mediaConnections.delete(peerId);
            app.removeVideoContainer(peerId);
        });
    }
})();
