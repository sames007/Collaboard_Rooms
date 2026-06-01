FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY CollaboardRooms.csproj ./
RUN dotnet restore CollaboardRooms.csproj

COPY . ./
RUN dotnet publish CollaboardRooms.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

COPY --from=build /app/publish ./

EXPOSE 8080
ENTRYPOINT ["dotnet", "CollaboardRooms.dll"]
