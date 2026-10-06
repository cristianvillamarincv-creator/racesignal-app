# Settings layout (release 1.1)

Settings is a compact list of grouped rows. Areas with controls of their own open a detail screen; nothing here edits a profile and there are no placeholder settings.

```
Settings                         app/settings/index.tsx
  [identity header: avatar, racing name, email]
  Race history                   Add a race manually · Find my races
  Subscription                   Plan (shows Free or Premium)      → settings/subscription
  Preferences                    Notifications                     → settings/notifications
                                 Signal privacy & consent          → settings/signal-privacy
  Account                        Sign-in methods                   → settings/sign-in-methods   (only when Apple or Google sign-in is enabled in the build)
  Help & legal                   Support · Privacy · Terms of Use  (links, opened directly)
  Account actions                Sign out · Delete account         (directly, with their confirmations)
  Developer tools                (one entry)                       → settings/developer          (development only)
```

What lives where:
- **Subscription:** the current plan, the existing Premium offer and Restore Purchases.
- **Notifications:** the per-type switches, the editable schedule, the iOS permission message and the schedule status (the existing section, unchanged).
- **Signal privacy & consent:** the Signal and Anthropic consent status and Withdraw.
- **Sign-in methods:** email, connected Apple and Google, connecting one to this account, and the linking guidance.
- **Developer tools:** Preview onboarding (needs the development preview opt-in) and the notification diagnostics and test tools (need the development app variant). The single entry shows when either existing gate is on; each tool keeps its own gate, so a production build shows neither.
- **Sign out and Delete account** keep their confirmations and cleanups (notifications cancelled before sign-out; deletion also clears the notification state and unsent Signal draft, and the Apple revocation prompts).

Implementation notes: the shared rows and styles are in `components/settings/SettingsRows.tsx` (one set of rows, dividers and touch targets for every Settings screen). The detail screens use the real auth, notification and purchase providers, so they sit inside the same `Stack.Protected` guard as `settings/index` and are not reachable from Developer Preview (`app/_layout.tsx`).
