# TuneDeck

A fast Spotify-style music player for LG webOS TVs (rooted with the Homebrew Channel), built because the
official Spotify TV app lags. Remote-first UI modelled on Spotify desktop with a Spicetify-style theme,
synced lyrics, profiles and a marketplace for themes and extensions.

- **Spotify**: plays your Spotify music, playlists and Liked Songs through Spotify's official Web Playback
  SDK (needs Spotify Premium). Your TV shows up as **TuneDeck TV** in Spotify Connect.
- **Without Spotify**: free music from [Audius](https://audius.co), plus importing your Spotify or
  YouTube library from a data export.
- Synced lyrics from [LRCLIB](https://lrclib.net); themes and extensions from the Spicetify community.

TuneDeck is free and non-commercial. Spotify's terms don't allow commercial use of its player.

## Install (once, on the computer)

Needs a rooted LG TV with SSH, and `ares-cli` on the computer.

```bash
TV_HOST=root@<tv-ip> ./scripts/deploy.sh
```

This installs the app and a small helper that runs on the TV (it serves the phone page used for sign-in
and imports). Nothing touches the TV's firmware.

## Signing in with Spotify

Spotify only lets an app made by an individual sign in with a key ("Client ID") that the listener creates
themselves, so each person sets up their own key once. It takes about 3 minutes and needs Spotify Premium.

1. On the TV: the first launch opens **Sign in with Spotify** (later: **Settings → Sign in with Spotify** or
   **Add profile → Sign in with Spotify**).
2. Put your phone on the **same Wi-Fi as the TV** and scan the QR code.
3. The phone walks you through it:
   1. Open the Spotify developer dashboard and log in with *your* Spotify account.
   2. Create an app called **TuneDeck**.
   3. Add the **Redirect URI** shown on the phone page (copy button), e.g. `https://192.168.1.3:8900/callback`.
   4. Tick **Web API** and **Web Playback SDK**, agree and **Save**.
   5. Copy your app's **Client ID** into the phone page and tap **Send to TV**.
4. Tap **Log in with Spotify**. Your phone warns that the connection isn't private: tap **Advanced**, then
   **Continue**. That's the TV's own certificate, used only to finish the sign-in.
5. Log in to Spotify and tap **Agree**. The TV signs in by itself.

The TV remembers your key for your profile, so signing in again later skips straight to step 4. Only the
Client ID goes to the TV; never share your Client secret. Reserve the TV's IP address in your router so the
redirect address keeps working.

## Using it

| Remote | What it does |
| --- | --- |
| Arrows, OK | Move and select |
| Back | Previous page; Home from any main section; closes full-screen views |
| ⏯ ⏪ ⏩ | Play/pause, jump 10 s back/forward |
| On the progress bar: ◀ ▶ | Jump 10 s |
| Blue | Full-screen player |
| Yellow | Full-screen player with lyrics |
| Red / Green | Lyrics 0.1 s earlier / later for this song |

The full-screen player has **Cover**, **Lyrics**, **Info** (song name and artist) and **Dark** switches, in
any combination, remembered per profile. **Settings → Lyrics delay for this TV** fixes lyrics that are always
off by the same amount, for example with a soundbar. **Settings → Smooth transitions** (0 to 12 seconds):
free songs truly crossfade (overlap); Spotify songs fade out and in. **8D** sound (circling around you) plays
by itself on every song that supports it, which is free songs; **Settings → 8D audio** turns it off.

Select **Your Library** at the top of the library panel to fold it into a narrow rail of covers (and back).
Pointing with the Magic Remote focuses what you point at; its wheel scrolls the list under the pointer.

If the TV feels slow, close other apps first (YouTube in particular stays in memory). The TV has about 1 GB
of RAM and swaps when it runs out.

Artist pages show the most popular songs and a **See all songs** button that collects every song from the
artist's albums and singles.

## Troubleshooting

- **"Site can't be reached" on the phone**: the phone isn't on the TV's Wi-Fi (mobile data or a guest
  network), or the router isolates devices. Use a computer on the same Wi-Fi instead.
- **"INVALID_CLIENT: Invalid redirect URI" / "redirect_uri not matching configuration"**: the Redirect URI
  isn't saved in the Spotify app being used. Add it exactly as shown and press Save.
- **"This Spotify account isn't on the app's allowed users list"**: you're logging in with a different
  Spotify account than the one that created the key. Use the same account, or add the other account under
  **Users and Access** in the dashboard.
**Marketplace extensions** are written for Spotify desktop's newer browser engine. TuneDeck converts each one
for the TV's engine when you open it (with [Babel](https://babeljs.io), bundled), then says whether it is
ready or only partly works because it relies on parts of Spotify desktop's interface that TuneDeck doesn't
have.

- **Logs**: the app writes to `/tmp/tunedeck-app.log` on the TV (`ssh root@<tv-ip> cat /tmp/tunedeck-app.log`).

## Limits from Spotify (developer apps, 2026)

- Playlists you follow but don't own play fine, but their song lists can't be shown. Spotify's own mixes
  (Daily Mix, artist Mixes, Discover Weekly) can't be read by apps at all; TuneDeck shows them by name and
  plays them as a whole.
- An artist's "Popular" songs come from a search, as Spotify removed that endpoint for developer apps.
- No music videos or Canvas loops: Spotify's player for other apps is audio-only, and its terms forbid
  pairing Spotify audio with other video.
- No crossfade overlap or 8D for Spotify songs: Spotify's player for other apps plays one stream at a time
  and its audio can't be processed by the app. Both work on free songs.
