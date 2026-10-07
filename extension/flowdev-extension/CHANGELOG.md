# Changelog

## [1.0.6] — 2026-10-10

### Fixed
- Extension now auto-reconnects on VS Code restart, window reload, and PC restart without any manual action
- Sidebar correctly shows MCP URL and pulsing yellow dot while connecting instead of showing the setup form
- Socket events now reach the sidebar panel when VS Code starts (previously they were silently dropped)
- Render server wake-up handled gracefully — status shows "Waking server..." and connects automatically when ready
- Reconnect backoff capped at 10 seconds (was growing indefinitely)
- 30 second connection timeout to handle Render free tier cold starts

All notable changes to FlowDev are documented here.

## [1.0.0] — 2026-10-03

### Added
- Token-based authentication using VS Code encrypted SecretStorage
- Clickable status bar item showing live connection state
- "Enter Token" prompt on first install with link to request access
- Quick-pick status menu (disconnect, change token, get access)
- `FlowDev: Set Access Token` command
- `FlowDev: Show Status` command
- Full Git integration: `git_status`, `git_add`, `git_commit`, `git_push`
- `ping` tool handler for connection testing
- Auto-reconnect with unlimited retry attempts
- Built-in code analyzer runs on every file write — catches hardcoded secrets, HTTP, eval(), missing error handling, and leftover console.log
- Multi-user session isolation — each user token routes to their own machine only
- Professional marketplace listing with icon, gallery banner, and full README

### Changed
- Publisher ID set to `flowdev` for marketplace publishing
- Extension name updated to `FlowDev — Claude AI in Your Editor`
- Minimum VS Code version set to `^1.85.0` for broader compatibility
- `engines.vscode` in package.json corrected from wildcard to proper range

### Fixed
- Git tools (`git_status`, `git_add`, `git_commit`, `git_push`) were missing from the tool executor — now all handled
- `userId` was hardcoded to `"default"` causing all users to share a session — now uses the user's personal token as their unique ID
