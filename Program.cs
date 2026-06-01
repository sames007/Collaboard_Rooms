using Microsoft.AspNetCore.HttpOverrides;
using CollaboardRooms.Hubs;

var builder = WebApplication.CreateBuilder(args);

var renderPort = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(renderPort))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{renderPort}");
}

builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.MaximumReceiveMessageSize = 32 * 1024;
});

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.Use(async (context, next) =>
{
    var headers = context.Response.Headers;

    headers.TryAdd("X-Content-Type-Options", "nosniff");
    headers.TryAdd("X-Frame-Options", "DENY");
    headers.TryAdd("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.TryAdd("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=()");
    headers.TryAdd(
        "Content-Security-Policy",
        string.Join(
            " ",
            "default-src 'self';",
            "base-uri 'self';",
            "object-src 'none';",
            "frame-ancestors 'none';",
            "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://www.whiteboard.team;",
            "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;",
            "font-src 'self' data: https://cdnjs.cloudflare.com;",
            "img-src 'self' data: blob:;",
            "media-src 'self' blob:;",
            "connect-src 'self' ws: wss: https://0.peerjs.com https://*.peerjs.com https://www.whiteboard.team;",
            "frame-src https://www.whiteboard.team;"));

    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHub<ChatHub>("/chatHub");
app.MapFallbackToFile("index.html");

app.Run();
