# Taipei 101: Sky Climber

An original 3D browser arcade game inspired by the rhythm of two-handed climbing games. Scale a stylized Taipei 101 facade one grip at a time, route around closing windows, recover from lost grips, brace against hazards, and reach the rooftop rescue.

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local address printed in the terminal. Other useful commands:

```bash
npm run test        # deterministic simulation tests
npm run lint        # code quality checks
npm run build       # production build
npm run verify      # lint, tests, and production build
```

## Deploy to Firebase Hosting

The Firebase build is a static version of the game. It does not require Cloud
Functions, Cloud Run, a database, or a paid Firebase plan.

### First-time setup

1. Create a Firebase project in the
   [Firebase console](https://console.firebase.google.com/) or select an
   existing project.
2. Install the Firebase CLI and sign in:

   ```bash
   npm install --global firebase-tools
   firebase login
   ```

3. Create a Hosting site. The site ID must be globally unique and becomes part
   of the default `web.app` address:

   ```bash
   firebase hosting:sites:create YOUR_UNIQUE_SITE_ID \
     --project YOUR_FIREBASE_PROJECT_ID
   ```

4. Connect the repository's logical `game` deploy target to that site:

   ```bash
   firebase target:apply hosting game YOUR_UNIQUE_SITE_ID \
     --project YOUR_FIREBASE_PROJECT_ID
   ```

This creates a local `.firebaserc` containing your Firebase project and site
mapping. The file is intentionally ignored by Git so a public fork does not
inherit someone else's deployment target.

### Build and deploy

Install dependencies, verify the static Firebase build, and deploy it:

```bash
npm install
npm run build:firebase
npm run deploy:firebase
```

`npm run deploy:firebase` rebuilds the game and deploys only the Hosting site
mapped to the `game` target. It does not modify other Hosting sites in the same
Firebase project.

To use a custom domain, add it to the selected site in the Firebase console and
then add the exact DNS records Firebase provides. Firebase provisions and
renews the TLS certificate automatically.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Left hand | W / A / S / D | Left directional pad |
| Right hand | Arrow keys | Right directional pad |
| Brace | Hold Space | Hold the center Brace button |
| Pause | Escape or P | Pause button |

Each command moves one hand to one neighboring grip. Alternate upward commands to climb. For a sidestep, move the outside hand first and follow with the inside hand. If a hand is dislodged, use that hand's controls before the recovery timer expires.

## Game structure

- 101 playable grip rows across five visual and difficulty sections
- Checkpoints at floors 1, 21, 41, 61, and 81
- Closing windows, falling debris, birds, and wind, each with a visual warning
- Three lives, checkpoint respawn, per-floor scoring, time/life victory bonus, and local best score
- Keyboard and independent multitouch controls with custom repeat timing
- Sound, reduced-motion, and quality settings stored locally when available

## Architecture

The authoritative game state is in `app/game/simulation.ts`. It uses integer facade coordinates and a fixed 60 Hz step. Rendering and character posing in `app/game/renderer.ts` consume snapshots but never change grip state. Authored hazard patterns live in `app/game/levels.ts`, and all core timing values are centralized in `app/game/config.ts`.

Repeated facade windows and grips use Three.js instancing. The tower, character, skyline, effects, and audio are procedural and require no third-party runtime assets or backend.

## Tuning

Edit `app/game/config.ts` for transfer time, recovery time, brace recharge, checkpoints, input repeat timing, and simulation catch-up limits. Hazard cadence and section patterns are in `app/game/levels.ts` and `app/game/simulation.ts`.

## Known limitations

- Gamepad controls and alternate game modes are intentionally outside the first release.
- Touch behavior and frame rate should be confirmed on physical phones and tablets; automated checks cover the deterministic rules and production output.
- Taipei 101 is an arcade-stylized procedural interpretation rather than an architectural replica.
