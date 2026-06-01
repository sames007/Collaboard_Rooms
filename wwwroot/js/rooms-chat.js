(() => {
    const app = window.Collaboard = window.Collaboard || {};
    const chatBox = document.getElementById("chatBox");
    const chatInput = document.getElementById("chatInput");
    const chatForm = document.getElementById("chatForm");

    chatForm.addEventListener("submit", event => {
        event.preventDefault();
        sendChat();
    });

    app.appendChatMessage = function appendChatMessage(name, message) {
        const paragraph = document.createElement("p");
        paragraph.className = "chat-message";

        const sender = document.createElement("strong");
        sender.textContent = `${name}: `;

        const text = document.createTextNode(message);
        paragraph.append(sender, text);
        chatBox.appendChild(paragraph);
        chatBox.scrollTop = chatBox.scrollHeight;
    };

    app.appendSystemMessage = function appendSystemMessage(message) {
        const paragraph = document.createElement("p");
        paragraph.className = "chat-message system";
        paragraph.textContent = message;
        chatBox.appendChild(paragraph);
        chatBox.scrollTop = chatBox.scrollHeight;
    };

    async function sendChat() {
        const message = chatInput.value.trim();

        if (!message) {
            return;
        }

        const connection = app.state.connection;
        if (!connection || connection.state !== signalR.HubConnectionState.Connected) {
            app.appendSystemMessage("Chat is still connecting. Try again in a moment.");
            return;
        }

        try {
            await connection.invoke("BroadcastMessage", message.slice(0, 1000));
            chatInput.value = "";
        } catch (error) {
            console.error("Unable to send chat message.", error);
            app.appendSystemMessage("Message was not sent. Please try again.");
        }
    }

    app.sendChat = sendChat;
})();
