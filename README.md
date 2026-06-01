# Collaboard Rooms

Collaboard Rooms is a real-time video collaboration app built with ASP.NET Core SignalR, PeerJS/WebRTC, chat, screen sharing, local recording, and an embedded whiteboard. The app is designed to run as one full-stack web service on Render and uses PeerJS Cloud for WebRTC peer discovery.

## Features

- Room-based real-time messaging with ASP.NET Core SignalR.
- Peer-to-peer audio and video calls through PeerJS/WebRTC.
- PeerJS Cloud signaling with the default PeerJS client configuration.
- Chat with server-side room validation and message length limits.
- Camera, microphone, screen sharing, virtual background, raise-hand, and local recording controls.
- Embedded whiteboard scoped to the current room.
- Responsive UI for desktop and mobile-sized screens.
- Docker-based deployment that works cleanly on Render.

## Requirements

- .NET SDK 9.0 or newer for local development.
- A modern browser with WebRTC support.
- Camera and microphone permissions for video calls.
- A GitHub repository if deploying through Render.

## Local Development

```powershell
dotnet restore CollaboardRooms.csproj
dotnet run
```

Open the URL shown by `dotnet run`, then use a room URL such as:

```text
http://localhost:5281/?room=team-demo
```

## Free Deployment Plan

Recommended free stack:

- Render: full app hosting as a free web service.
- PeerJS Cloud: free WebRTC signaling used by the PeerJS default client.
- GitHub: source control and Render deployment source.

Render free web services can spin down after inactivity, so the first request after a quiet period may be slower. That is acceptable for a resume/demo project, but it is not production-grade hosting.

## Deploying To Render

1. Push this repository to GitHub.
2. Create a Render account and connect the GitHub repository.
3. Choose `New` -> `Blueprint` if Render detects `render.yaml`, or create a `Web Service`.
4. Use the Docker runtime.
5. Select the free plan.
6. Deploy.

The included `render.yaml` configures the app as a free Docker web service. The app reads Render's `PORT` environment variable automatically.

## Security Notes

- Do not commit service keys, tokens, or deployment credentials.
- User-provided chat and labels are inserted with text APIs to avoid script injection.
- The hub derives room, peer, and username state from the connected client instead of trusting client-supplied room values for actions.
- The app sends security headers, including a content security policy, `nosniff`, frame protection, referrer policy, and browser permission limits.
- Free PeerJS Cloud is convenient for demos. For a production app, use a private PeerServer with authentication and abuse controls.

## Verification

Useful checks before deploying:

```powershell
dotnet build CollaboardRooms.csproj
dotnet format CollaboardRooms.sln --verify-no-changes
dotnet list CollaboardRooms.csproj package --vulnerable --include-transitive --source https://api.nuget.org/v3/index.json
node --check wwwroot/js/app.js
node --check wwwroot/js/peer-connection.js
node --check wwwroot/js/video-controls.js
node --check wwwroot/js/ui-controls.js
node --check wwwroot/js/whiteboard.js
node --check wwwroot/js/chat.js
```
