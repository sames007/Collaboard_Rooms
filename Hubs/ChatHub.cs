using Microsoft.AspNetCore.SignalR;

namespace CollaboardRooms.Hubs;

/// <summary>
/// Coordinates room membership and trusted real-time events for Collaboard clients.
/// The hub keeps only lightweight connection state; media still flows peer-to-peer.
/// </summary>
public sealed class ChatHub : Hub
{
    private const int MaxRoomLength = 64;
    private const int MaxPeerIdLength = 128;
    private const int MaxUsernameLength = 40;
    private const int MaxMessageLength = 1_000;
    private const int MaxVideoEffectLength = 32;

    private static readonly object SyncRoot = new();
    private static readonly HashSet<string> AllowedVideoEffects = new(StringComparer.Ordinal)
    {
        "none",
        "blur",
        "blue-studio",
        "midnight-grid",
        "neon-focus",
        "cool-mono"
    };
    private static readonly Dictionary<string, HashSet<string>> RoomPeers = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, string> ConnectionPeerMap = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, string> ConnectionRoomMap = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, string> ConnectionUserMap = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, string> PeerUsernameMap = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, string> PeerVideoEffectMap = new(StringComparer.Ordinal);

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var departure = RemoveConnection(Context.ConnectionId);

        if (departure is not null)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, departure.Room);
            await Clients.Group(departure.Room).SendAsync("UserDisconnected", departure.PeerId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(string room, string peerId, string username)
    {
        var normalizedRoom = NormalizeRequired(room, nameof(room), MaxRoomLength);
        var normalizedPeerId = NormalizeRequired(peerId, nameof(peerId), MaxPeerIdLength);
        var normalizedUsername = NormalizeRequired(username, nameof(username), MaxUsernameLength);

        Departure? previousMembership;
        List<PeerInfo> existingPeers;

        lock (SyncRoot)
        {
            previousMembership = RemoveConnectionLocked(Context.ConnectionId);

            if (ConnectionPeerMap.Any(entry =>
                    string.Equals(entry.Value, normalizedPeerId, StringComparison.Ordinal) &&
                    !string.Equals(entry.Key, Context.ConnectionId, StringComparison.Ordinal)))
            {
                throw new HubException("This peer is already connected.");
            }

            if (!RoomPeers.TryGetValue(normalizedRoom, out var peers))
            {
                peers = new HashSet<string>(StringComparer.Ordinal);
                RoomPeers[normalizedRoom] = peers;
            }

            existingPeers = peers
                .Select(id => new PeerInfo(
                    id,
                    PeerUsernameMap.GetValueOrDefault(id, "Guest"),
                    PeerVideoEffectMap.GetValueOrDefault(id, "none")))
                .ToList();

            peers.Add(normalizedPeerId);
            ConnectionPeerMap[Context.ConnectionId] = normalizedPeerId;
            ConnectionRoomMap[Context.ConnectionId] = normalizedRoom;
            ConnectionUserMap[Context.ConnectionId] = normalizedUsername;
            PeerUsernameMap[normalizedPeerId] = normalizedUsername;
            PeerVideoEffectMap.TryAdd(normalizedPeerId, "none");
        }

        if (previousMembership is not null)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, previousMembership.Room);
            await Clients.Group(previousMembership.Room).SendAsync("UserDisconnected", previousMembership.PeerId);
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, normalizedRoom);
        await Clients.Caller.SendAsync("ExistingPeers", existingPeers);
        await Clients.OthersInGroup(normalizedRoom).SendAsync("UserConnected", normalizedPeerId, normalizedUsername, "none");
    }

    public Task BroadcastMessage(string message)
    {
        var caller = GetCallerState(Context.ConnectionId);
        var normalizedMessage = NormalizeRequired(message, nameof(message), MaxMessageLength);

        return Clients.Group(caller.Room).SendAsync("broadcastMessage", caller.Username, normalizedMessage);
    }

    public Task ToggleCamera(bool isEnabled)
    {
        var caller = GetCallerState(Context.ConnectionId);
        return Clients.OthersInGroup(caller.Room).SendAsync("CameraToggled", caller.PeerId, isEnabled);
    }

    public Task ToggleVirtualBackground()
    {
        var caller = GetCallerState(Context.ConnectionId);
        return Clients.OthersInGroup(caller.Room).SendAsync("VirtualBackgroundToggled", caller.PeerId);
    }

    public Task SetVideoEffect(string effect)
    {
        var caller = GetCallerState(Context.ConnectionId);
        var normalizedEffect = NormalizeVideoEffect(effect);

        lock (SyncRoot)
        {
            PeerVideoEffectMap[caller.PeerId] = normalizedEffect;
        }

        return Clients.OthersInGroup(caller.Room).SendAsync("VideoEffectChanged", caller.PeerId, normalizedEffect);
    }

    public Task RaiseHand()
    {
        var caller = GetCallerState(Context.ConnectionId);
        return Clients.OthersInGroup(caller.Room).SendAsync("UserRaisedHand", caller.PeerId);
    }

    public Task StartScreenShare()
    {
        var caller = GetCallerState(Context.ConnectionId);
        return Clients.OthersInGroup(caller.Room).SendAsync("ScreenShareStarted", caller.PeerId);
    }

    public Task StopScreenShare()
    {
        var caller = GetCallerState(Context.ConnectionId);
        return Clients.OthersInGroup(caller.Room).SendAsync("ScreenShareStopped", caller.PeerId);
    }

    public Task ToggleRecording(bool isRecording)
    {
        var caller = GetCallerState(Context.ConnectionId);
        return Clients.OthersInGroup(caller.Room).SendAsync("RecordingToggled", caller.PeerId, isRecording);
    }

    private static CallerState GetCallerState(string connectionId)
    {
        lock (SyncRoot)
        {
            if (ConnectionRoomMap.TryGetValue(connectionId, out var room) &&
                ConnectionPeerMap.TryGetValue(connectionId, out var peerId) &&
                ConnectionUserMap.TryGetValue(connectionId, out var username))
            {
                return new CallerState(room, peerId, username);
            }
        }

        throw new HubException("Join a room before using this feature.");
    }

    private static Departure? RemoveConnection(string connectionId)
    {
        lock (SyncRoot)
        {
            return RemoveConnectionLocked(connectionId);
        }
    }

    private static Departure? RemoveConnectionLocked(string connectionId)
    {
        if (!ConnectionPeerMap.TryGetValue(connectionId, out var peerId) ||
            !ConnectionRoomMap.TryGetValue(connectionId, out var room))
        {
            return null;
        }

        if (RoomPeers.TryGetValue(room, out var peers))
        {
            peers.Remove(peerId);

            if (peers.Count == 0)
            {
                RoomPeers.Remove(room);
            }
        }

        ConnectionPeerMap.Remove(connectionId);
        ConnectionRoomMap.Remove(connectionId);
        ConnectionUserMap.Remove(connectionId);
        PeerUsernameMap.Remove(peerId);
        PeerVideoEffectMap.Remove(peerId);

        return new Departure(room, peerId);
    }

    private static string NormalizeRequired(string value, string fieldName, int maxLength)
    {
        var normalized = (value ?? string.Empty).Trim();

        if (normalized.Length == 0)
        {
            throw new HubException($"{fieldName} is required.");
        }

        if (normalized.Length > maxLength)
        {
            throw new HubException($"{fieldName} cannot exceed {maxLength} characters.");
        }

        return normalized;
    }

    private static string NormalizeVideoEffect(string effect)
    {
        var normalized = NormalizeRequired(effect, nameof(effect), MaxVideoEffectLength);

        if (!AllowedVideoEffects.Contains(normalized))
        {
            throw new HubException("Unsupported video effect.");
        }

        return normalized;
    }

    private sealed record CallerState(string Room, string PeerId, string Username);

    private sealed record Departure(string Room, string PeerId);

    private sealed record PeerInfo(string PeerId, string Username, string VideoEffect);
}
