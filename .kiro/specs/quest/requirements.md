# Quest (GPS, gems, simulation): Requirements

Part of the StepQuest specs; see [../README.md](../README.md) for the introduction, glossary and index. Requirement ids are kept from the original single spec so history stays traceable.

Related: [routing](../routing/requirements.md) (rerouting, Requirement 7c), [voice-audio](../voice-audio/requirements.md) (callouts), [retro-ui](../retro-ui/requirements.md).

## Requirements

### Requirement 6 (Phase 2): GPS and checkpoints

**User Story:** As a walker, I want the map to follow me and count my checkpoints, so that the walk plays like a game.

#### Acceptance Criteria

1. WHEN the user presses "Use my location", THE SYSTEM SHALL request one high-accuracy position, use it as the start, and load a live map area (within the Overpass limits of Requirement 1) IF the position is outside the loaded map.
2. WHILE a quest is active, THE SYSTEM SHALL ignore fixes less accurate than 50 m, fixes with stale timestamps, and jumps faster than 7 m/s (unless three consecutive fixes agree), and SHALL smooth accepted fixes.
3. WHILE a quest is active, THE SYSTEM SHALL draw the walker at the position snapped to the route (or at the filtered position when off-route) and keep the camera on the walker until the user drags the map.
4. THE SYSTEM SHALL collect checkpoints only in route order, WHEN the filtered position is within 22 m of the next checkpoint (plus half of any accuracy above 10 m, at most 35 m) OR the walker passes its position along the route while on the route.
5. WHEN a checkpoint is collected, THE SYSTEM SHALL play a pickup animation and sound, and SHALL show next checkpoint, distance, direction, collected/total, distance walked, steps walked (distance ÷ stride), elapsed time and pace. WHEN the final checkpoint (the flag) is collected, THE SYSTEM SHALL show a "Quest complete" screen with stats.
6. WHEN the walker is more than 40 m (or 1.5 × accuracy) from the route for two fixes in a row, THE SYSTEM SHALL show an off-route hint with a direction.
7. IF location permission is denied, times out, is unavailable, or the page is not secure, THEN THE SYSTEM SHALL explain it in the user's language and keep the app usable (tap-to-place, simulation).
8. THE SYSTEM SHALL save the active quest to local storage and resume it after a reload or lost signal (restoring the same map), and SHALL keep the screen on with the Screen Wake Lock API where supported.
9. THE SYSTEM SHALL offer a "Simulate walk" mode that moves the walker along the route at a chosen speed with optional GPS noise.
