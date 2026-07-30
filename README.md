# CrewLink

CrewLink is a local-network communication room for live event crews. This first prototype provides room creation, room joining, live presence, WebRTC tap-to-talk audio, and director speaking priority.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000` in a browser.

## Install as a phone app

CrewLink is a progressive web app (PWA). Open the deployed URL on Android Chrome or iPhone Safari, then choose **Install app** or **Add to Home Screen**. It launches in its own app window, uses the deployed CrewLink server when online, and shows a dedicated **YOU ARE OFFLINE** page if it cannot load while offline.

## Test on phones

1. Connect every phone and the server computer to the same Wi-Fi or hotspot.
2. Start the server with `npm start`.
3. Find the server computer's local IPv4 address using `ipconfig` on Windows.
4. On each phone, open `http://YOUR-COMPUTER-IP:3000`.
5. One person creates a room; everyone else joins using its room ID.

## Voice requirements

CrewLink sends voice directly between people in the same room using WebRTC; the server only coordinates rooms and connection setup. Allow microphone access when your browser asks. The TALK button shows a live wave meter when your microphone detects voice and turns green only after the room grants you the channel.

`localhost` is trusted for microphone use during development. When testing on phones through a local IP address, browsers typically require HTTPS before they allow microphone access. Packaging the project as an Android app or serving it with a local HTTPS certificate resolves that requirement.

For reliable online phone-to-phone audio, configure a TURN relay in your hosting environment. Add the following settings in Render under the CrewLink service environment variables, then redeploy:

```text
TURN_URLS=turn:your-turn-server.example:3478?transport=udp,turn:your-turn-server.example:3478?transport=tcp
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

Without a TURN relay, chat and room presence still work, but some mobile networks block the direct WebRTC path needed for voice.

## Roles, devices, and chat

The person who creates an event is the Director. On a desktop-sized browser, the Director receives a dashboard with crew access details, live crew presence, camera status, and communication controls. People who choose **Join an event** enter as Crew and keep the compact, phone-first control room.

After entering a room, use the bottom bar to switch between **Home** and **Chat**. The chat is shared instantly with everyone in the room, and the theme button switches between dark and light modes. The home screen uses a live camera-production background to keep the app focused on event work.

## Deploy on Render

The included `render.yaml` deploys the complete app and Socket.IO backend together, so the installed phone app connects to the same hosted URL. Push this folder to GitHub, then create a new Render Blueprint from the repository. Render reads `render.yaml`, installs dependencies with `npm ci`, starts the service with `npm start`, and checks `/api/health` before making the app live.
