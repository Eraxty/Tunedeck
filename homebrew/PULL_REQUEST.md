Add TuneDeck

#### Application description

TuneDeck is a remote-first music player for LG webOS TVs, laid out like Spotify desktop. It plays the
viewer's own Spotify Premium account through Spotify's official Web Playback SDK (each user signs in with
their own Spotify developer key; nothing is bypassed), plus free music from Audius without an account.
Synced lyrics, queue, profiles, and colour themes / extensions from the Spicetify community.

Root is optional. With root, a small Node helper (phone sign-in page, OAuth redirect relay, imports) is set
up on first launch through `org.webosbrew.hbchannel.service/exec`: it runs from the app folder, keeps state
in `/var/lib/webosbrew/tunedeck`, and symlinks `helper/init.sh` into `/var/lib/webosbrew/init.d` (the
script checks its target exists and starts the helper in the background). Nothing is written to system
partitions.

Source: https://github.com/Eraxty/Tunedeck (MIT)
Tested on: LG 43UM7300PTA, webOS TV 4.10.2

#### Submission checklist

- [ ] I have tested this application on a real webOS TV.
- [ ] I confirm that this submission complies with the repository rules.

#### AI-use declaration

- [ ] No AI tools were used.
- [ ] AI tools were used for limited assistance (for example, explanations, small snippets, or editing).
- [ ] AI tools were used for research or planning; the application was developed by a human.
- [ ] AI coding agents were used; an experienced developer has reviewed and tested all generated code.
- [ ] The application was produced primarily by AI without meaningful human development or review.
- [ ] Other (please describe below).
