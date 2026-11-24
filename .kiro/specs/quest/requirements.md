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

### Requirement 6b (review, Nov 2026): A trustworthy quest runner

**User Story:** As a walker, I want my distance, gems and finish to be right even when the GPS is noisy, jumps, goes quiet or the app is reloaded, so that the game never cheats me and never gets stuck.

#### Acceptance Criteria

1. WHEN a fix has a latitude or longitude that is not a finite number in range, THE SYSTEM SHALL reject it with the reason `invalid` and SHALL NOT show the weak-signal hint for it.
2. WHEN a fix reports an accuracy of 0, a negative number, NaN or none, THE SYSTEM SHALL treat the accuracy as unknown and use 20 m for the filter, the pickup radius, the off-route threshold and the odometer, instead of rejecting the fix or trusting it as perfect.
3. WHEN a fix has a timestamp that is not later than the last accepted fix (a duplicate or an out-of-order fix), THE SYSTEM SHALL ignore it. WHEN three fixes in a row are more than 30 s behind the last accepted fix (the device clock was set back), THE SYSTEM SHALL continue from the new clock instead of freezing.
4. WHILE tracking through the browser, THE SYSTEM SHALL drop fixes whose timestamp is more than 30 s older than the device clock (a cached position delivered after the page was in the background) or more than 60 s ahead of it.
5. WHEN a fix is further from the last accepted raw fix than the walking speed limit allows (counting the accuracy of both readings), THE SYSTEM SHALL treat it as an outlier. THE SYSTEM SHALL accept a new position after outliers only WHEN three outliers in a row agree with one another, not merely WHEN three outliers arrive.
6. THE SYSTEM SHALL NOT add distance to the odometer while the walker stands still within the GPS noise: movement counts only once the smoothed position is further than twice the reported accuracy (at least 4 m, at most 30 m) from the last anchor. A position accepted after agreeing outliers SHALL add at most the distance the speed limit allows for the time elapsed. The odometer SHALL never decrease.
7. THE SYSTEM SHALL collect each gem exactly once and in route order. WHEN one fix reaches or passes several gems, THE SYSTEM SHALL collect all of them in that order. WHEN fixes are far apart in time (backgrounded page, tunnel), THE SYSTEM SHALL count a gem as passed when the walker advanced along the route no more than max(100 m, 3 m/s × elapsed time), and SHALL NOT count it for an advance the elapsed time makes implausible.
8. THE SYSTEM SHALL finish a quest only WHEN the last gem (the flag) has been collected, which requires every earlier gem to have been collected. A saved quest whose gem count is inconsistent with its route SHALL be refused instead of finishing at the next fix.
9. WHEN the walker is off the route, THE SYSTEM SHALL need to come within 70 % of the off-route distance to be on the route again (hysteresis), so one noisy fix does not reset the deviation. WHEN the "you left the route" message ends for any reason (back on the route or heading for the gem again), THE SYSTEM SHALL emit `backOnRoute`.
10. WHEN a reroute answer arrives, THE SYSTEM SHALL apply it only WHEN it was computed for this quest, this reroute count and this number of collected gems, the walker is still off the route and still within 60 m of the position it was computed for. A failed reroute request SHALL be ignored without an unhandled rejection.
11. THE SYSTEM SHALL save the quest with a schema version and SHALL migrate saved quests of an older version when loading. A saved quest of a newer version (after an app downgrade) SHALL be left in storage untouched and not resumed. A saved quest with invalid fields SHALL be discarded. A saved quest SHALL NOT be resumed on a map that does not contain its route; a demo-map quest that no longer fits SHALL be discarded.
12. THE SYSTEM SHALL add the steps of a real (not simulated) quest to the "steps today" total as they are walked, once, and for the calendar day of the fix that produced them, so that a walk ended after midnight, a quest left unfinished and an expired save are not lost, not counted twice and not moved to another day. Simulated walks SHALL NOT count.
13. THE SYSTEM SHALL hold at most one screen wake lock, SHALL release it when tracking stops even if the request resolves afterwards, and SHALL report to the UI whenever the lock is gained or lost.
14. THE SYSTEM SHALL show "no signal" WHEN a real quest has had no accepted fix for 30 s, and "weak signal" WHEN fixes have been rejected for poor accuracy for 5 s, from one pure function of the quest state and the clock.
15. THE SYSTEM SHALL keep the quest rules (filter, odometer, gems, off-route, finish, persistence format, step credit, reroute tickets) in pure modules without React or browser APIs, and the React hook SHALL only connect the location source, sound, wake lock and rendering to them.
16. WHEN the quest ends, the page is closed or the hook unmounts, THE SYSTEM SHALL stop the location source and the simulator (also in the middle of a tick), release the wake lock, drop pending reroute answers and ignore late errors and fixes.
17. WHEN the user runs the demo walk at ×1 to ×120, THE SYSTEM SHALL still collect every gem in order and finish, with and without GPS noise and glitches; a gentle reroute toward the next gem SHALL still not show "you left the route".

### Requirement 6c (task 69): Step counting

**User Story:** As a walker, I want the steps on screen to be the steps the app counts, so that 10,000 means the same everywhere.

#### Acceptance Criteria

1. THE SYSTEM SHALL keep the stride between 0.4 m and 1.2 m in whole centimetres wherever it is stored or typed (saved settings included), so the stride shown is the stride used.
2. THE SYSTEM SHALL convert metres to steps by rounding to the nearest whole step, and steps to metres without rounding; steps → metres → steps SHALL return the same number for every goal from 100 to 60,000 steps and every stride in whole centimetres.
3. WHEN the stride or the height is not a finite number, THE SYSTEM SHALL use the default stride.
